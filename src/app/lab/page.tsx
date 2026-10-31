import type { Metadata } from "next";
import { LabDashboard } from "@/components/lab/LabDashboard";

export const metadata: Metadata = {
  title: "Revenant Lab",
  robots: { index: false, follow: false },
};

// Read the env at request time so setting LAB_PASSCODE takes effect without a rebuild.
export const dynamic = "force-dynamic";

export default function LabPage() {
  return <LabDashboard unprotected={!process.env.LAB_PASSCODE} />;
}
