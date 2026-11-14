import type { Metadata } from "next";
import { CONTACT_EMAIL, EFFECTIVE_DATE, OPERATOR } from "../details";

export const metadata: Metadata = {
  title: "Privacy Policy | InView",
  description: "How InView handles account information, Google sign-in and saved library content.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicy() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p>Effective {EFFECTIVE_DATE}</p>
      <p>
        {OPERATOR} operates InView, a personal library for saved articles, documents and posts.
        This policy covers the information processed when you use InView at getinview.app.
      </p>

      <h2>Account information and Google sign-in</h2>
      <p>
        Clerk handles authentication. When you use Google sign-in, Google shares your account identifier,
        email address and basic profile information, such as your name and profile image when available,
        with Clerk. Clerk stores this information as part of your authentication record. InView uses your
        Clerk account identifier to identify your session and associate your library and settings with your account.
      </p>
      <p>
        InView uses Google account information for sign-in and account management. Your profile name and image
        may appear in your account controls and private writing previews. Google sign-in does
        not give InView access to your Gmail, Drive files, contacts or calendar. InView does not send Google
        sign-in information to AI providers to train models or use it for advertising. You can manage third-party
        access in your Google Account settings.
      </p>

      <h2>Your library and activity</h2>
      <p>
        InView processes the links, posts, documents and other content you save, as well as your highlights,
        notes, reading progress, questions, drafts and preferences. Some data, including locally retained PDF
        originals, is stored in your browser. Signing in enables server storage and synchronization of supported
        library and writing data. InView also stores processing status and usage records to run jobs,
        apply limits and reconcile provider charges.
      </p>

      <h2>Service providers and connections</h2>
      <p>
        InView uses Vercel to host the service, Clerk to authenticate users and Neon to store server data.
        When you use a connected research or AI feature, InView may send the relevant query, URL,
        text or excerpts and writing instructions to the provider used for that feature. Providers can include
        OpenAI, Google, TypeSafe, Exa and Monid. Your optional provider keys are stored encrypted and used
        on the server to authenticate requests to those providers. Disconnecting a key stops future use of that
        connection. Requests already authorized may still finish.
      </p>
      <p>
        If you connect X or an external agent, InView uses the connection to carry out the actions you request,
        such as importing bookmarks or retrieving sources. An agent you authorize can read or modify data
        within the permissions of its connection. Those services handle information under their own terms.
      </p>

      <h2>Reasons for processing and browser storage</h2>
      <p>
        InView uses account and library information to provide the features you request, and processes limited
        technical and usage information to operate and secure the service, troubleshoot failures and prevent abuse.
        Clerk uses session cookies for sign-in. InView uses browser storage for local reading data, progress
        and preferences. Clearing site data removes that browser’s local copy.
      </p>

      <h2>Retention, deletion and your rights</h2>
      <p>
        Account and synced library information are retained as needed to provide the service. You can remove
        library items from your active library and disconnect provider keys in InView. Removed items and their
        revisions can remain in server records. You can also request access to, correction of,
        export of or deletion of your account and personal information. Signing out or revoking Google access
        alone does not delete synced library data. Limited records may remain where needed for security,
        billing reconciliation, legal obligations or backup recovery.
      </p>
      <p>
        Depending on your location, you may also have the right to object to or restrict processing and to
        lodge a complaint with your data protection authority. Service providers may process data in other
        countries. You can ask for more information about how your information is handled.
      </p>
      <p>
        For privacy questions or requests, contact <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
