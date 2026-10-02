import { useContentQueue, type QueuedContent } from "@/store/contentQueue";
import { useContentState } from "@/store/contentState";

/** Wartet, bis kein Inhalts-Vorgang mehr läuft (auch keiner, der nicht aus der Warteschlange kommt). */
function untilIdle() {
  if (!useContentState.getState().active) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = useContentState.subscribe((state) => {
      if (state.active) return;
      stop();
      resolve();
    });
  });
}

/** Läuft schon etwas oder wartet schon etwas, kommt ein weiterer Vorgang hinten an. */
export const mustWait = () => !!useContentState.getState().active || useContentQueue.getState().jobs.length > 0;

const takeNext = () => {
  const [next, ...rest] = useContentQueue.getState().jobs;
  useContentQueue.setState({ jobs: rest });
  return next;
};

let draining = false;

/** Arbeitet die Warteschlange ab; ein Vorgang bleibt darin sichtbar (und entfernbar), bis er an der Reihe ist. */
async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (useContentQueue.getState().jobs.length > 0) {
      await untilIdle();
      // Hat zwischen Leerlauf und Fortsetzen ein anderer Vorgang begonnen, bleibt der Auftrag in der Warteschlange.
      if (useContentState.getState().active) continue;
      try {
        await takeNext()?.start();
      } catch (error) {
        // Ein Auftrag, der wirft (etwa sein Abschluss-Callback), darf die übrigen nicht liegen lassen.
        console.error(error);
      }
    }
  } finally {
    draining = false;
  }
}

/** Startet den Vorgang, sobald nichts anderes läuft; weitere Vorgänge reihen sich dahinter ein. */
export function enqueueContent(job: Omit<QueuedContent, "id">) {
  useContentQueue.setState((state) => ({ jobs: [...state.jobs, { ...job, id: crypto.randomUUID() }] }));
  void drain();
}

export const dequeueContent = (id: string) => useContentQueue.setState((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
