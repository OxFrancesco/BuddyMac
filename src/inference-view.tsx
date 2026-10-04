import { useEffect, useState } from 'react'
import { inference, useInference, type TextProvider } from './inference'
import { nav } from './nav'
import { Button, Choice, ErrorText, Field, Row, Setting, Text } from './ui'

export function InferenceSettingsView() {
  const s = useInference()
  const [callback, setCallback] = useState('')
  const [error, setError] = useState('')
  const act = (work: () => Promise<unknown>) => { setError(''); void work().catch(cause => setError(cause instanceof Error ? cause.message : 'Settings could not be saved.')) }
  useEffect(() => { act(() => inference.load()) }, [])
  const openLogin = () => { if (s.loginUrl) Bun.spawn(['/usr/bin/open', s.loginUrl], { env: { ...process.env }, stdout: 'ignore', stderr: 'ignore' }) }
  return <>
    <ErrorText message={error || s.error} />
    <Setting label="Text provider" detail="Used for Write, dictation cleanup and voice edits.">
      <Choice id="inference-provider" width={260} value={s.settings.provider} items={[{ value: 'openai', label: 'ChatGPT subscription' }, { value: 'openai-codex', label: 'ChatGPT via Codex' }, { value: 'openrouter', label: 'OpenRouter' }]} onChange={value => act(() => inference.configure({ provider: value as TextProvider, model: s.settings.model || 'gpt-6.1-sol' }))} />
    </Setting>
    {s.settings.provider === 'openrouter' ? <Setting label="OpenRouter key" detail={s.connected ? 'Saved in Keychain.' : 'Add a key to use OpenRouter.'}><Button onClick={() => nav.go('Talk', 'Settings')}>Manage key</Button></Setting> : <>
      <Setting label="ChatGPT account" detail={s.login ? s.code ? `Enter ${s.code} in your browser.` : 'Complete sign-in in your browser.' : s.connected ? 'Connected.' : 'Sign in with your own subscription.'}>
        {s.login ? <Row><Button id="inference-open-login" disabled={!s.loginUrl} onClick={openLogin}>Open sign-in</Button><Button id="inference-cancel-login" onClick={() => inference.cancelLogin()}>Cancel</Button></Row> : s.connected ? <Button id="inference-disconnect" onClick={() => act(() => inference.disconnect())}>Disconnect</Button> : <Button id="inference-connect" onClick={() => act(() => inference.connect())}>Sign in with ChatGPT</Button>}
      </Setting>
      {s.prompt ? <Setting label={s.prompt}><Row><div style={{ width: 280 }}><Field id="inference-callback" value={callback} onChange={setCallback} placeholder="Paste the callback URL" /></div><Button id="inference-submit-callback" disabled={!callback.trim()} onClick={() => { inference.answer(callback); setCallback('') }}>Continue</Button></Row></Setting> : null}
      <Setting label="Text model"><Choice id="inference-model" width={300} value={s.settings.model} items={s.models.map(model => ({ value: model.id, label: model.name }))} onChange={model => act(() => inference.configure({ model }))} /></Setting>
    </>}
    <Setting label="Dock image model" detail="Uses OpenRouter credits. ChatGPT's image quota is unavailable through Pi."><Choice id="inference-image-model" width={300} value={s.settings.imageModel} items={s.imageModels.map(model => ({ value: model.id, label: model.name.replace(/^[^:]+:\s*/, '').split(' (')[0]!.slice(0, 28) }))} onChange={imageModel => act(() => inference.configure({ imageModel }))} /></Setting>
    <Setting label="Liny" detail="Uses its selected personal provider and model."><Button onClick={() => nav.go('Liny', 'Settings')}>Liny settings</Button></Setting>
    <Setting label="Saved AI requests" detail="Write, cleanup and Dock requests are stored privately on this Mac."><Button id="inference-clear" onClick={() => act(() => inference.clearRequests())}>Clear requests</Button></Setting>
  </>
}
