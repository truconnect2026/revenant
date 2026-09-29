import type { Metadata } from "next";
import { EvpReview } from "@/components/EvpReview";

export const metadata: Metadata = {
  title: "EVP Review — Revenant",
};

export default function ReviewPage() {
  return <EvpReview />;
}
