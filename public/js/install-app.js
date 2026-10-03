import { useEffect, useState } from 'preact/hooks';
import { html } from './lib.js';
import { Button, Dialog } from './ui.js';

export function InstallApp() {
  const [open, setOpen] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [enabled, setEnabled] = useState(false), [prompt, setPrompt] = useState(null);
  useEffect(() => {
    const install = e => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', install);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(reg => reg.pushManager?.getSubscription()).then(sub => setEnabled(Boolean(sub))).catch(() => setMessage('Не удалось подготовить приложение. Проверьте соединение.'));
    return () => window.removeEventListener('beforeinstallprompt', install);
  }, []);
  const toggle = async () => {
    setBusy(true); setMessage('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Для iPhone: Safari → Поделиться → На экран «Домой», затем откройте приложение с иконки. Требуется iOS 16.4 или новее.');
      // Permission request must run directly in the click handler on iOS.
      if (!enabled && await Notification.requestPermission() !== 'granted') throw new Error('Разрешение не выдано. Уведомления можно разрешить в настройках телефона.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (enabled && sub) {
        const res = await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
        if (!res.ok) throw new Error('Сервер не подтвердил отключение. Повторите.');
        await sub.unsubscribe(); setEnabled(false); setMessage('Уведомления выключены.');
      } else {
        const config = await (await fetch('/api/push/config')).json();
        if (!config.publicKey) throw new Error('Служба уведомлений недоступна.');
        const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
        if (!res.ok) throw new Error((await res.json()).error);
        setEnabled(true); setMessage('Включено: каждое новое событие журнала. Старые записи не рассылаются.');
      }
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return html`<${Button} size="sm" icon="smartphone" onClick=${() => setOpen(true)}>Установить / уведомления</${Button}>
    <${Dialog} id="install-app" open=${open} onClose=${() => setOpen(false)} title="КТЖ на главном экране">
      <img src="/assets/ktz-emblem.png" width="72" height="72" alt="Эмблема КТЖ" />
      <p>iPhone: откройте сайт в Safari → «Поделиться» → «На экран Домой» → «Добавить». Затем запускайте КТЖ с новой иконки.</p>
      <p>Android: меню браузера → «Установить приложение» или «Добавить на главный экран».</p>
      ${prompt && html`<${Button} onClick=${async () => { await prompt.prompt(); setPrompt(null); }}>Установить приложение</${Button}>`}
      <h3>Уведомления из журнала</h3><p>Режим «Каждое событие»: отправления, приёмы, смены бригад, задержки и неисправности. На всей сети сообщений много. Подписка общая для модели, включается только для этого устройства.</p>
      <${Button} pending=${busy} onClick=${toggle}>${enabled ? 'Выключить уведомления' : 'Включить каждое событие'}</${Button}>
      <p role="status">${message}</p><p class="muted">Доставка при закрытом приложении зависит от сети, разрешений и ограничений iOS/Android. Полная история всегда остаётся в журнале.</p>
    </${Dialog}>`;
}
