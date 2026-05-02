import { useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, RotateCcw, X } from "lucide-react";

type Props = {
  session: any;
  onClose: () => void;
  onRestart: () => Promise<void>;
};

export function RestartSessionDialog({ session, onClose, onRestart }: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmText = `restart ${session.slug}`;
  const canRestart = confirmation.trim() === confirmText;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRestart || isRestarting) return;

    setError(null);
    setIsRestarting(true);
    try {
      await onRestart();
      onClose();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setIsRestarting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal restart-session-modal"
        aria-modal="true"
        aria-labelledby="restart-session-title"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <div className="modal-meta">session restart</div>
            <h2 className="modal-title" id="restart-session-title">
              restart {session.slug}
            </h2>
          </div>
          <button type="button" className="btn btn-quiet icon-btn" onClick={onClose}>
            <X size={15} />
            <span className="sr-only">close</span>
          </button>
        </div>

        <div className="modal-body restart-session-body">
          <div className="destructive-callout">
            <AlertTriangle size={16} />
            <div>
              <strong>This returns the session to its initial ledger state.</strong>
              <p>
                Experiments, runs, patches, artifacts, logs, notes, planning cycles,
                events, and memory entries recorded for this session will be deleted.
                The session contract and settings are kept.
              </p>
            </div>
          </div>

          <label className="field">
            <span className="field-label">type to confirm</span>
            <input
              className="input"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={confirmText}
              autoFocus
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            cancel
          </button>
          <button type="submit" className="btn btn-warn" disabled={!canRestart || isRestarting}>
            {isRestarting ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
            restart session
          </button>
        </div>
      </form>
    </div>
  );
}
