import Link from "next/link";
import { Card } from "@/components/ui";

export default function ContractNotFound() {
  return (
    <Card className="mx-auto max-w-lg space-y-3 p-6">
      <h1 className="text-xl font-semibold">This contract no longer exists</h1>
      <p className="text-sm text-ink-soft">
        The hosted demo runs on a free server that resets its data after 15 minutes of inactivity. Load the demo contract
        again to start a fresh one.
      </p>
      <Link href="/" className="inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90">
        Back to home
      </Link>
    </Card>
  );
}
