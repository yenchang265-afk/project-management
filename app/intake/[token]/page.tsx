import { IntakeForm } from "./IntakeForm";

/* Public intake page — no session required; the URL token is the credential.
   Submissions land as `intake`-tagged work items on the form's target item. */
export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <IntakeForm token={token} />;
}
