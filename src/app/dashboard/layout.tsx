import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unown — Mission Control",
  description:
    "Live mission control for the self-improving agent: runs, cycles, dreams, memory versions, hook decisions.",
};

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
