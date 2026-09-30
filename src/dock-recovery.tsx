import { useState } from 'react'
import { openSettingsPane } from './platform'
import { Button, Column, ErrorText, Row, Text } from './ui'

export function needsAppManagement(error: string) {
  return error.includes('App Management')
}

export function DockRecovery({ error, retry, onError, dismiss }: {
  error: string
  retry: () => Promise<void>
  onError: (error: string) => void
  dismiss?: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function tryAgain() {
    setBusy(true)
    try { await retry(); onError('') }
    catch (cause) { onError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <Column style={{ gap: 12, flexShrink: 0 }}>
    <ErrorText message={error} />
    <Text muted>Enable BuddyMac in App Management, then return here and retry. macOS may ask you to reopen BuddyMac.</Text>
    <Row style={{ flexWrap: 'wrap' }}>
      <Button id="dock-permission-settings" primary onClick={() => openSettingsPane('appManagement')}>Open App Management</Button>
      <Button id="dock-permission-retry" disabled={busy} onClick={() => void tryAgain()}>{busy ? 'Retrying…' : 'Retry'}</Button>
      {dismiss ? <Button id="dock-permission-dismiss" quiet disabled={busy} onClick={dismiss}>Dismiss</Button> : null}
    </Row>
  </Column>
}
