"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, FileJson, RefreshCcw } from "lucide-react";

interface EvidenceOperation {
  operationId: string;
  lucidTaskId: string;
  state: string;
  direction: "payout" | "refund";
  reasonCode: string;
  paymentTransactionHash: string;
  keeperhubExecutionId: string;
  settlementTransactionHash: string;
  receiptVerified: boolean;
}

interface EvidenceBundle {
  schemaVersion: string;
  mode: "awaiting_live_run" | "base_sepolia_live" | "test_fixture";
  network: string;
  generatedAt: string | null;
  operations: EvidenceOperation[];
}

function short(value: string): string {
  return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-value"
      aria-label={`Copy ${label}`}
      title={`Copy ${value}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    >
      <span>{short(value)}</span>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

export function EvidenceLedger() {
  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [error, setError] = useState(false);
  const load = async () => {
    setError(false);
    try {
      const response = await fetch("/evidence/receipts.json", { cache: "no-store" });
      if (!response.ok) throw new Error("evidence unavailable");
      setBundle((await response.json()) as EvidenceBundle);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/evidence/receipts.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("evidence unavailable");
        return response.json() as Promise<EvidenceBundle>;
      })
      .then((nextBundle) => {
        if (active) setBundle(nextBundle);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="ledger-empty" role="alert">
        <FileJson aria-hidden="true" />
        <div>
          <strong>Evidence file could not be read.</strong>
          <p>Rebuild the public receipt bundle, then try again.</p>
        </div>
        <button type="button" onClick={() => void load()}>
          <RefreshCcw aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  if (!bundle) {
    return <div className="ledger-loading" aria-label="Loading evidence ledger" />;
  }

  if (bundle.operations.length === 0) {
    return (
      <div className="ledger-empty">
        <FileJson aria-hidden="true" />
        <div>
          <span className="evidence-mode">LIVE RUN PENDING</span>
          <strong>The ledger is deliberately empty.</strong>
          <p>
            No placeholder hashes are presented as proof. Run the funded Base
            Sepolia demo to publish real payout and refund receipts.
          </p>
          <code>npm run demo:live</code>
        </div>
        <a href="https://github.com/ahmardchain/lucid-keeperhub-settlement#live-demo" target="_blank" rel="noreferrer">
          Demo guide <ExternalLink aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <div className="ledger-wrap">
      <div className="ledger-meta">
        <span className="evidence-mode">
          {bundle.mode === "base_sepolia_live" ? "BASE SEPOLIA LIVE" : "TEST FIXTURE"}
        </span>
        <span>{bundle.operations.length} terminal operations</span>
        <span>{bundle.generatedAt ? new Date(bundle.generatedAt).toLocaleString() : ""}</span>
      </div>
      <div className="ledger-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Operation</th>
              <th scope="col">Lucid task</th>
              <th scope="col">Decision</th>
              <th scope="col">KeeperHub execution</th>
              <th scope="col">Settlement tx</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {bundle.operations.map((operation) => (
              <tr key={operation.operationId}>
                <td><CopyValue value={operation.operationId} label="operation ID" /></td>
                <td><CopyValue value={operation.lucidTaskId} label="Lucid task ID" /></td>
                <td>
                  <span className={`ledger-decision is-${operation.direction}`}>
                    {operation.direction}
                  </span>
                  <small>{operation.reasonCode}</small>
                </td>
                <td><CopyValue value={operation.keeperhubExecutionId} label="KeeperHub execution ID" /></td>
                <td>
                  <a
                    href={`https://sepolia.basescan.org/tx/${operation.settlementTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="tx-link"
                  >
                    {short(operation.settlementTransactionHash)}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </td>
                <td>
                  <span className="verified-receipt">
                    <Check aria-hidden="true" /> {operation.receiptVerified ? "verified" : "unverified"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
