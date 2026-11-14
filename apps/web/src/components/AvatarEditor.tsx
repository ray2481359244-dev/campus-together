import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { avatarMaxBytes } from '@campus/contracts';
import type { AvatarStateDTO, MeDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StudentAvatar } from './visual/StudentArtwork';
import { FormError } from './UI';

const formats = ['image/jpeg', 'image/png', 'image/webp'];

export function AvatarEditor({ user, close, saved }: { user: MeDTO; close: () => void; saved: (message: string) => void }) {
  const auth = useAuth(), picker = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState(''), [ready, setReady] = useState(false);
  const [restoring, setRestoring] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revision = useRef(user.avatarRevision);

  useEffect(() => { chooseButton.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.onerror = () => setError('照片无法读取，请重新选择。');
    reader.readAsDataURL(file);
    return () => { if (reader.readyState === FileReader.LOADING) reader.abort(); };
  }, [file]);

  function choose(next: File | null) {
    setReady(false); setPreview(''); setError(''); setRestoring(false);
    if (picker.current) picker.current.value = '';
    if (next && (!formats.includes(next.type) || !next.size || next.size > avatarMaxBytes)) {
      setFile(null); setError('请选择 3 MB 以内的 JPEG、PNG 或 WebP 照片。'); return;
    }
    setFile(next);
  }

  async function save(restore: boolean) {
    if (busy || !restore && !ready) return;
    setBusy(true); setError('');
    try {
      const { data } = await api<AvatarStateDTO>('/me/avatar', {
        method: restore ? 'DELETE' : 'PUT', body: { revision: revision.current, ...(restore ? {} : { base64: preview.split(',')[1] }) },
      });
      auth.updateAvatar(user.id, data);
      saved(restore ? '已恢复默认头像。' : '头像已更新。');
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'AVATAR_CHANGED') {
        try {
          const { data } = await api<MeDTO>('/me/profile');
          auth.updateAvatar(user.id, data);
          revision.current = data.avatarRevision; setRestoring(false);
          setError('头像已在其他页面更新。请核对当前头像后再操作。');
        } catch (readFailure) { setError(messageOf(readFailure)); }
      } else setError(messageOf(failure));
    } finally { setBusy(false); }
  }

  return <form className="paper form-stack profile-avatar-editor" aria-label="编辑头像" onSubmit={event => { event.preventDefault(); void save(false); }}>
    <div className="avatar-edit-row">
      <div className="avatar-preview">
        {preview ? <img src={preview} alt="新头像预览" onLoad={() => setReady(true)} onError={() => {
          choose(null); setError('无法打开这张照片，请重新选择。');
        }} /> : <StudentAvatar seed={user.id} version={restoring ? null : user.avatarVersion} />}
        <span>{restoring ? '默认头像' : preview ? '头像预览' : '当前头像'}</span>
      </div>
      <div className="form-field avatar-select">
        <button ref={chooseButton} className="button secondary" type="button" disabled={busy}
          aria-describedby="avatar-note" onClick={() => picker.current?.click()}><ImagePlus size={16} aria-hidden="true" />
          {file ? '重新选择照片' : '选择头像照片'}
        </button>
        <input ref={picker} type="file" accept={formats.join(',')} disabled={busy} aria-label="头像照片文件" hidden
          onChange={event => choose(event.target.files?.[0] ?? null)} />
        {file && <span className="avatar-file-name">{file.name}</span>}
        <span id="avatar-note" className="field-note">取照片中央的方形区域。支持 JPEG、PNG、WebP，最大 3 MB。登录同学可见。</span>
      </div>
    </div>
    <FormError>{error}</FormError>
    <div className="button-row">
      {restoring ? <button className="button" type="button" disabled={busy} onClick={() => void save(true)}>{busy ? '正在恢复……' : '确认恢复默认头像'}</button> :
        <button className="button" type="submit" disabled={!ready || busy}>{busy ? '正在保存……' : '保存头像'}</button>}
      {!restoring && user.avatarVersion && <button className="button secondary" type="button" disabled={busy} onClick={() => {
        choose(null); setRestoring(true);
      }}>恢复默认头像</button>}
      <button className="text-button" type="button" disabled={busy} onClick={close}>取消</button>
    </div>
  </form>;
}
