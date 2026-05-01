import { useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

type Props = {
  session: any;
  onClose: () => void;
  onRemove: () => Promise<void>;
};

export function RemoveSessionDialog({ session, onClose, onRemove }: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmText = `delete ${session.slug}`;
  const canRemove = confirmation.trim() === confirmText;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRemove || isRemoving) return;

    setError(null);
    setIsRemoving(true);
    try {
      await onRemove();
      onClose();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal remove-session-modal"
        aria-modal="true"
        aria-labelledby="remove-session-title"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <div className="modal-meta">session removal</div>
            <h2 className="modal-title" id="remove-session-title">
              remove {session.slug}
            </h2>
          </div>
          <button type="button" className="btn btn-quiet icon-btn" onClick={onClose}>
            <X size={15} />
            <span className="sr-only">close</span>
          </button>
        </div>

        <div className="modal-body remove-session-body">
          <div className="destructive-callout">
            <AlertTriangle size={16} />
            <div>
              <strong>This removes the session from the ledger.</strong>
              <p>
                Experiments, runs, patches, artifacts, logs, notes, planning cycles, and
                events recorded for this session will be deleted from Convex.
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
          <button type="submit" className="btn btn-warn" disabled={!canRemove || isRemoving}>
            {isRemoving ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
            remove session
          </button>
        </div>
      </form>
    </div>
  );
}
