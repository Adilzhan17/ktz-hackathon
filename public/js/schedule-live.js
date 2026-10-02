import { useEffect, useState } from 'preact/hooks';
export function useLiveSchedule() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const source = new EventSource('/api/schedule-events');
    source.addEventListener('schedule', e => { try { setState({ ...JSON.parse(e.data), loading: false, failed: false }); } catch { setState(s => ({ ...s, failed: true })); } });
    source.onerror = () => setState(s => ({ ...s, loading: false, failed: true }));
    return () => source.close();
  }, []);
  return state;
}
