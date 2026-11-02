import { useEffect, useId, useRef, type ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

export default function WorkoutConfirmation({ title, children, confirmLabel, error, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    cancel.current?.focus()
    return () => {
      element?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog ref={dialog} className="record-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onCancel() }}>
      <h3 id={`${id}-title`}>{title}</h3>
      <div id={`${id}-description`} className="record-dialog-description">{children}</div>
      {error && <p className="record-error" role="alert">{error}</p>}
      <div className="record-dialog-actions">
        <button ref={cancel} className="record-button record-button-primary" type="button" onClick={onCancel}>Annuler</button>
        <button className="record-button record-button-confirm-delete" type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  )
}
