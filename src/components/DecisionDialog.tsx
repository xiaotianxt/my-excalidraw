import { useEffect, useRef, type ReactNode } from 'react';

export function DecisionDialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="decision-dialog" aria-labelledby="decision-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="decision-title">{title}</h2>
    {children}
  </dialog>;
}
