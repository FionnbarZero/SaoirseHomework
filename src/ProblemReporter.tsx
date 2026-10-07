import { useEffect, useRef, useState } from 'react'
import './problem-reporter.css'

type Report = { id: string; createdAt: string; screen: string; day: string; connection: string; page: string; description: string }
const KEY = 'saoirse-quest-problem-reports-v1'
const DRAFT = 'saoirse-quest-problem-draft-v1'
function readReports(): Report[] {
  const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
  if (!Array.isArray(parsed) || !parsed.every(r => r && ['id', 'createdAt', 'screen', 'day', 'connection', 'page', 'description'].every(key => typeof r[key] === 'string'))) throw new Error('Saved reports could not be read. Existing data has been left unchanged.')
  return parsed
}
function format(reports: Report[]) {
  return reports.map(r => `SAOIRSE QUEST — PROBLEM REPORT\nDate: ${r.createdAt}\nScreen: ${r.screen}\nHomework day: ${r.day}\nConnection: ${r.connection}\nPage: ${r.page}\nReport ID: ${r.id}\n\n${r.description}`).join('\n\n------------------------------\n\n')
}

export default function ProblemReporter({ screen, day, connection }: { screen: string; day: string; connection: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [description, setDescription] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [message, setMessage] = useState('')
  const [exportText, setExportText] = useState('')
  useEffect(() => {
    try { setReports(readReports()); setDescription(localStorage.getItem(DRAFT) || '') }
    catch { setMessage('Browser storage is unavailable or contains unreadable reports. You can still download or copy a report below.') }
  }, [])
  const current = (): Report => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), screen, day, connection, page: location.origin + location.pathname, description: description.trim() })
  const save = () => {
    if (!description.trim()) { setMessage('Describe the problem first.'); return }
    const report = current()
    try {
      const next = [...readReports(), report]
      localStorage.setItem(KEY, JSON.stringify(next))
      setReports(next)
    } catch {
      setExportText(format([report]))
      setMessage('Could not save on this device. Your text is still here: copy it or download the draft before closing.')
      return
    }
    setDescription('')
    try { localStorage.removeItem(DRAFT) } catch { /* The report itself has already been saved. */ }
    setMessage('Saved in this browser on this device. Nothing was sent online.')
  }
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = name; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    setMessage('Download requested. Look in your Downloads folder.')
  }
  const copy = async (text: string) => {
    setExportText(text)
    try { await navigator.clipboard.writeText(text); setMessage('Copied. Paste into your Codex project.') }
    catch { setMessage('Automatic copy was unavailable. Select the text below and copy it manually.') }
  }
  return <>
    <button className="problem-launch" onClick={() => dialog.current?.showModal()}>Report a problem</button>
    <dialog ref={dialog} className="problem-dialog" aria-labelledby="problem-title">
      <div className="problem-heading"><h2 id="problem-title">Report a problem</h2><button onClick={() => dialog.current?.close()} aria-label="Close problem reports">Close</button></div>
      <p>Saved only in this browser on this device. Download a backup before clearing browser data or using a different device. Nothing is sent to Codex automatically.</p>
      <p>Current screen: <strong>{screen}</strong> · {day}</p>
      <label htmlFor="problem-description">What happened? What did you expect? What steps caused it?</label>
      <textarea id="problem-description" rows={5} maxLength={20000} value={description} onChange={e => {
        setDescription(e.target.value)
        try { localStorage.setItem(DRAFT, e.target.value) }
        catch { setMessage('Draft cannot be saved in this browser. Download or copy it before closing.') }
      }} placeholder="For example: I clicked Start on Du Chinese, but…" />
      <p className="problem-hint">Include only details you want to share. Passwords and calendar contents are not collected automatically.</p>
      <div className="problem-actions"><button disabled={!description.trim()} onClick={save}>Save report on this device</button><button disabled={!description.trim()} onClick={() => download(format([current()]), 'saoirse-quest-problem-draft.txt')}>Download draft</button><button disabled={!description.trim()} onClick={() => void copy(format([current()]))}>Copy draft</button></div>
      <p role="status">{message}</p>
      <h3>Saved reports ({reports.length})</h3>
      <div className="problem-actions"><button disabled={!reports.length} onClick={() => download(format(reports), 'saoirse-quest-problems.txt')}>Download all reports</button><button disabled={!reports.length} onClick={() => void copy(format(reports))}>Copy all for Codex</button></div>
      {[...reports].reverse().map(report => <article className="problem-item" key={report.id}><strong>{report.screen} · {new Date(report.createdAt).toLocaleString()}</strong><p>{report.description}</p><div className="problem-actions"><button onClick={() => void copy(format([report]))}>Copy report</button><button onClick={() => download(format([report]), `saoirse-quest-problem-${report.id}.txt`)}>Download report</button></div></article>)}
      {exportText && <><label htmlFor="problem-export">Text ready to paste into Codex</label><textarea id="problem-export" readOnly rows={7} value={exportText} onFocus={e => e.target.select()} /></>}
    </dialog>
  </>
}
