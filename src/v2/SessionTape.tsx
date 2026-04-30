type Session = {
  _id: string;
  slug: string;
  title: string;
  status: string;
  activeRunCount?: number;
  completedExperimentCount?: number;
  targetExperimentCount?: number;
};

type Props = {
  sessions: Session[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

export function SessionTape({ sessions, selectedId, onSelect }: Props) {
  if (sessions.length === 0) return null;

  return (
    <nav className="session-tape" aria-label="Sessions">
      <span className="label">sessions</span>
      {sessions.map((s) => {
        const isCurrent = s._id === selectedId;
        return (
          <button
            key={s._id}
            type="button"
            onClick={() => onSelect(s._id)}
            className="session-pill"
            data-status={s.status}
            aria-current={isCurrent || undefined}
            title={`${s.title} · ${s.completedExperimentCount ?? 0}/${s.targetExperimentCount ?? 0} done`}
          >
            <span className="glyph" aria-hidden="true" />
            <span>{s.slug}</span>
          </button>
        );
      })}
    </nav>
  );
}
