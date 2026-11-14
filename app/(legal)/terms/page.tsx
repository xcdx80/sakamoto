import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, EFFECTIVE_DATE, OPERATOR } from "../details";

export const metadata: Metadata = {
  title: "Terms of Service | InView",
  description: "Terms for using InView and its library, writing and connected features.",
  alternates: { canonical: "/terms" },
};

export default function TermsOfService() {
  return (
    <article>
      <h1>Terms of Service</h1>
      <p>Effective {EFFECTIVE_DATE}</p>
      <p>
        These terms apply to your use of InView at getinview.app. {OPERATOR} operates InView,
        which lets you save, read and search sources and use them in your writing.
      </p>

      <h2>Your account and connections</h2>
      <p>
        Keep your sign-in methods, provider keys and agent tokens secure. Connect only accounts and credentials
        you are authorized to use. You can disconnect providers and revoke agent tokens in InView. External
        providers apply their own terms and may bill you for requests made with your keys. InView’s usage limits
        apply to activity within InView.
      </p>

      <h2>Your content and acceptable use</h2>
      <p>
        You retain any rights you have in content you submit. You give InView permission to store, copy, index
        and process that content to provide the features you use, including synchronization and requests you
        authorize to connected providers. Save and share only material you are entitled to use. Respect
        copyright, privacy and the rights of people whose content appears in your library.
      </p>
      <p>
        Do not use InView to break the law, access another person’s account or data without permission,
        spread malware, interfere with the service or circumvent its security or usage limits.
      </p>

      <h2>Search, answers and drafts</h2>
      <p>
        Search results, citations and AI-generated text can be incomplete or inaccurate. Check the underlying
        sources and review drafts before relying on or publishing them. External sources and integrations
        may change or become unavailable.
      </p>

      <h2>Availability and ending use</h2>
      <p>
        You can stop using InView at any time. Keep a separate copy of material you need to retain. Features
        may change or be interrupted for maintenance, security or provider availability. Access may be
        restricted to address abuse, a security issue or a legal obligation. These terms do not limit rights
        you have under applicable consumer law.
      </p>
      <p>
        The <Link href="/privacy">Privacy Policy</Link> explains how InView processes personal information
        and how to make a request about your data.
      </p>
      <p>
        For questions about these terms, contact <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
