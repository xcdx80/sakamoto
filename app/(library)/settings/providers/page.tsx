import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ProviderSettingsAccount } from "@/components/account/ProviderSettingsAccount";
export default async function ProviderSettingsPage() {
  const {userId} = await auth();
  if (!userId) redirect("/");
  return <ProviderSettingsAccount />;
}
