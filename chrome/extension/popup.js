const mode = document.querySelector('#mode')
const detail = document.querySelector('#detail')
const policy = document.querySelector('#policy')
const checked = document.querySelector('#checked')
const dot = document.querySelector('#dot')
const refresh = document.querySelector('#refresh')

function render(status) {
  dot.className = status?.connected ? (status.mode === 'homework' ? 'warn' : 'good') : ''
  mode.textContent = status?.connected
    ? status.mode === 'homework' ? 'Homework mode' : status.mode === 'free' ? 'Free mode' : 'Standing by'
    : 'Service unavailable'
  detail.textContent = status?.connected
    ? status.mode === 'homework'
      ? 'Approved learning pages are active. Other web navigation returns to the homework path.'
      : 'Chrome navigation is currently unrestricted.'
    : status?.error ?? 'Open the homework app to reconnect the local service.'
  policy.textContent = status?.policyVersion ?? '—'
  checked.textContent = status?.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleTimeString() : '—'
}

async function request(type) {
  render(await chrome.runtime.sendMessage({ type }))
}

refresh.addEventListener('click', () => { void request('syncNow') })
void request('getStatus')
