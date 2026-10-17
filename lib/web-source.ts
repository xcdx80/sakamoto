/** Bounded HTTP transport. Resolve/check every hop, then pin that address at connection time. */
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { APP_UA } from "./brand";
type Address = { address: string; family: number };
type RequestOptions = {
  address: Address;
  signal: AbortSignal;
  headers: Record<string, string>;
};
export type ArticleFetchAdapters = {
  lookup?: (host: string) => Promise<Address[]>;
  request?: (url: URL, options: RequestOptions) => Promise<Response>;
};
async function pinnedRequest(
  url: URL,
  options: RequestOptions,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        signal: options.signal,
        headers: options.headers,
        lookup: ((_host, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [options.address]);
          else callback(null, options.address.address, options.address.family);
        }) satisfies LookupFunction,
      },
      (res) => {
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new Response(
              [204, 205, 304].includes(res.statusCode ?? 200)
                ? null
                : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
              { status: res.statusCode ?? 502, headers },
            ),
          );
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    request.on("error", reject);
    request.end();
  });
}
let adapters: ArticleFetchAdapters = {};
export function configureArticleFetch(options: ArticleFetchAdapters) {
  adapters = options;
}
function privateAddress(raw: string): boolean {
  let ip = raw.toLowerCase();
  if (isIP(ip) === 6) {
    try {
      ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    } catch {
      return true;
    }
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(ip);
    if (mapped) {
      const n = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16);
      return privateAddress(
        [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."),
      );
    }
    if (ip.startsWith("::ffff:")) return privateAddress(ip.slice(7));
    // Global unicast only; exclude documentation, transition/tunnel ranges.
    return (
      !/^[23][\da-f]{3}:/.test(ip) ||
      ip.startsWith("2001:db8:") ||
      (ip.startsWith("2001:") && parseInt(ip.split(":")[1], 16) < 0x200) ||
      ip.startsWith("2002:") ||
      ip.startsWith("3fff:")
    );
  }
  if (isIP(ip) !== 4) return true;
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 &&
      (b === 168 ||
        (b === 0 && (c === 0 || c === 2)) ||
        (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
async function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Source deadline exceeded."));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export type WebSourceResult =
  | { ok: true; bytes: Uint8Array; url: string; type: string }
  | {
      ok: false;
      error: string;
      status: number;
      retryable?: boolean;
      kind?: "pdf";
    };
export async function fetchWebSource(
  raw: string,
  options: { deadline?: number; pdf?: boolean } = {},
): Promise<WebSourceResult> {
  const remaining = Math.min(
    15_000,
    (options.deadline ?? Date.now() + 15_000) - Date.now(),
  );
  if (remaining <= 0)
    return {
      ok: false,
      error: "Source deadline exceeded.",
      status: 504,
      retryable: true,
    };
  const signal = AbortSignal.timeout(remaining);
  let response: Response | undefined;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))
      return {
        ok: false,
        error: "Only HTTP(S) sources can be imported.",
        status: 400,
      };
    let url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    for (let hop = 0; hop <= 5; hop++) {
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return {
          ok: false,
          error: "Only HTTP(S) links without credentials can be imported.",
          status: 400,
        };
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (
        host === "localhost" ||
        host.endsWith(".local") ||
        host.endsWith(".internal")
      )
        return {
          ok: false,
          error: "That address is not reachable from here.",
          status: 400,
        };
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await within(
            (adapters.lookup ?? ((h) => lookup(h, { all: true })))(host),
            signal,
          );
      if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
        return {
          ok: false,
          error: "That address is not reachable from here.",
          status: 400,
        };
      response = await within(
        (adapters.request ?? pinnedRequest)(url, {
          address: addresses[0],
          signal,
          headers: {
            "User-Agent": `Mozilla/5.0 (compatible; ${APP_UA}; +reader)`,
            Accept: "text/html,application/xhtml+xml,application/pdf",
            "Accept-Encoding": "identity",
          },
        }),
        signal,
      );
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || hop === 5)
          return {
            ok: false,
            error: "Too many or invalid redirects.",
            status: 422,
          };
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return {
          ok: false,
          error: `Source returned HTTP ${response.status}.`,
          status: response.status,
          retryable:
            response.status === 429 ||
            response.status >= 500 ||
            response.status === 408,
        };
      }
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!options.pdf && type.includes("application/pdf")) {
        await response.body?.cancel();
        return {
          ok: false,
          error: "PDF text processing is pending.",
          status: 415,
          kind: "pdf",
        };
      }
      const sniffPdf = Boolean(options.pdf && (!type || type.includes("application/octet-stream")));
      let limit =
        options.pdf && (type.includes("application/pdf") || sniffPdf)
          ? 25_000_000
          : 6_000_000;
      if (Number(response.headers.get("content-length")) > limit) {
        await response.body?.cancel();
        return {
          ok: false,
          error: "Source exceeds the import byte limit.",
          status: 413,
        };
      }
      const reader = response.body?.getReader();
      const parts: Uint8Array[] = [];
      let length = 0;
      let prefix = "";
      if (reader)
        try {
          while (true) {
            const { value, done } = await within(reader.read(), signal);
            if (done) break;
            length += value.byteLength;
            if (sniffPdf && prefix.length < 5) {
              prefix += new TextDecoder().decode(value.slice(0,5-prefix.length));
              if (prefix.length === 5 && prefix !== "%PDF-") limit = 6_000_000;
            }
            if (length > limit) {
              await reader.cancel();
              return {
                ok: false,
                error: "Source exceeds the import byte limit.",
                status: 413,
              };
            }
            parts.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      return { ok: true, bytes, url: url.toString(), type };
    }
    return { ok: false, error: "Too many redirects.", status: 422 };
  } catch {
    await response?.body?.cancel().catch(() => {});
    return {
      ok: false,
      error:
        "Source did not answer before the deadline, or could not be reached.",
      status: 502,
      retryable: true,
    };
  }
}
