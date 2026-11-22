// Physio view of the patient's guided sessions: what they did, where they stopped and why, pain after each exercise.
// Read-only. A stopped exercise or a pain score here is information for the physio; it does not change the tier or the plan.
import type { Patient, ProtocolPack } from '../types';
import { exerciseName } from '../exercises/library';
import { exerciseFinished } from '../session/engine';

export function SessionsCard({ patient, pack }: { patient: Patient; pack: ProtocolPack }) {
  const sessions = [...(patient.sessions ?? [])].reverse().slice(0, 7);
  if (!sessions.length) return null;
  const reasonLabel = (r: string) => r;
  return (
    <div className="card" data-testid="sessions-card">
      <h3>Guided sessions <small>(what the patient tapped in the app or chat; not a measure of how well the movement was done)</small></h3>
      {sessions.map((s) => (
        <details key={s.id} open={s === sessions[0]}>
          <summary>{s.date} · {s.exercises.filter(exerciseFinished).length}/{s.exercises.length} exercises finished{s.via === 'whatsapp' ? ' (WhatsApp)' : ''}{s.answeredBy === 'caregiver' ? ' (caregiver)' : ''}{s.exercises.some((x) => x.struggling) ? ' · asked for help' : ''}</summary>
          <table className="gate"><tbody>
            {s.exercises.map((x) => (
              <tr key={x.id}>
                <td>{exerciseName(x.id, 'en')}</td>
                <td>{x.setsDone}/{x.setsPlanned} sets, {x.repsDone} reps</td>
                <td>{x.stopped ? <b>stopped: {reasonLabel(x.stopped)}</b> : ''}{x.struggling ? ' · asked for help' : ''}</td>
                <td>{x.pain !== undefined ? `pain ${x.pain}/10` : ''}</td>
              </tr>
            ))}
          </tbody></table>
        </details>
      ))}
    </div>
  );
}
