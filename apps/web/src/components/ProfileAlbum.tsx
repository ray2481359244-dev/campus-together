import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Plus, Trash2, X } from 'lucide-react';
import { profileAlbumLimit, profilePhotoMaxBytes } from '@campus/contracts';
import type { PhotoVisibility, ProfilePhotoDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { ErrorState, FormError, Loading } from './UI';
import { ReportButton } from './ReportButton';

const visibilityLabels = { PRIVATE: '仅自己', CAMPUS: '登录同学可见' };
const photoUrl = (photo: ProfilePhotoDTO, size: 'thumb' | 'full') => '/api/v1/profile-photos/' + photo.id + '/' + size + '?v=' + photo.revision;

export function ProfileAlbum({ ownerId, viewerId }: { ownerId: string; viewerId: string }) {
  const own = ownerId === viewerId, client = useQueryClient();
  const [manage, setManage] = useState(false), [view, setView] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const key = ['profile-album', ownerId, viewerId];
  const result = useQuery({
    queryKey: key, queryFn: ({ signal }) => api<ProfilePhotoDTO[]>('/profiles/' + ownerId + '/album', { signal }),
    retry: false, refetchInterval: own ? false : 12_000,
  });
  const photos = result.data?.data ?? [];
  const index = photos.findIndex(photo => photo.id === view);

  async function change(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setRemoving(null); setNotice(success); }
    catch (failure) { setError(messageOf(failure)); }
    finally { await client.invalidateQueries({ queryKey: key }); setBusy(false); }
  }
  function move(photo: ProfilePhotoDTO, delta: number) {
    const at = photos.indexOf(photo), previous = photos.map(item => item.id), order = [...previous];
    [order[at], order[at + delta]] = [order[at + delta], order[at]];
    void change(() => api('/me/album/order', { method: 'PUT', body: { previous, order } }), '照片顺序已保存。');
  }
  return <section className="paper profile-panel profile-album" aria-label="个人相册">
    <header className="profile-panel-head">
      <h2><Camera size={21} aria-hidden="true" />个人相册</h2>
      {own && <button type="button" className="text-button" aria-expanded={manage} onClick={() => setManage(value => !value)}>
        {manage ? '完成管理' : photos.length ? '管理相册' : '添加照片'}
      </button>}
    </header>
    {result.isPending ? <Loading label="正在读取相册……" /> : result.isError
      ? <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />
      : photos.length === 0 && !manage ? <div className="album-empty"><Camera size={24} aria-hidden="true" /><p>{own ? '留几张照片，分享你喜欢的校园瞬间。' : '暂无可看的照片。'}</p></div>
      : <ul className="album-grid">{photos.map((photo, i) => <li className="album-tile" key={photo.id}>
        <button type="button" className="album-thumbnail" aria-label={'查看第 ' + (i + 1) + ' 张照片'} onClick={() => setView(photo.id)}>
          <img src={photoUrl(photo, 'thumb')} alt="" loading="lazy" />
          {own && !manage && <span>{visibilityLabels[photo.visibility]}</span>}
        </button>
        {own && manage && <div className="album-controls">
          <select aria-label={'第 ' + (i + 1) + ' 张照片的可见范围'} disabled={busy} value={photo.visibility} onChange={event => {
            const visibility = event.target.value as PhotoVisibility;
            void change(() => api('/me/album/' + photo.id, { method: 'PATCH', body: { visibility, revision: photo.revision } }), '可见范围已更新。');
          }}>{Object.entries(visibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="album-control-row">
            <button type="button" className="message-icon" aria-label={'前移第 ' + (i + 1) + ' 张照片'} disabled={busy || i === 0} onClick={() => move(photo, -1)}><ArrowUp size={17} /></button>
            <button type="button" className="message-icon" aria-label={'后移第 ' + (i + 1) + ' 张照片'} disabled={busy || i === photos.length - 1} onClick={() => move(photo, 1)}><ArrowDown size={17} /></button>
            <button type="button" className="message-icon danger" aria-label={'移除第 ' + (i + 1) + ' 张照片'} disabled={busy} onClick={() => setRemoving(photo.id)}><Trash2 size={17} /></button>
          </div>
        </div>}
      </li>)}</ul>}
    {manage && removing && <section className="confirm-box" aria-label="确认移除照片">
      <p>移除这张照片？移除后，已有链接也无法访问。</p>
      <div className="button-row">
        <button type="button" className="button danger-button" disabled={busy} onClick={() => void change(() => api('/me/album/' + removing, { method: 'DELETE' }), '照片已移除。')}>确认移除照片</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => setRemoving(null)}>保留照片</button>
      </div>
    </section>}
    <FormError>{error}</FormError>
    {notice && <p className="success-text" role="status">{notice}</p>}
    {own && manage && (photos.length >= profileAlbumLimit ? <p className="form-note">已添加 {profileAlbumLimit} 张，移除一张即可继续添加。</p>
      : <PhotoUpload disabled={busy || result.isPending || result.isError} saved={async () => {
        setNotice('照片已添加。');
        await client.invalidateQueries({ queryKey: key });
      }} />)}
    {index >= 0 && <PhotoViewer photo={photos[index]} index={index} count={photos.length} own={own}
      close={() => setView(null)} navigate={delta => setView(photos[index + delta].id)} />}
  </section>;
}

function PhotoUpload({ disabled, saved }: { disabled: boolean; saved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState('');
  const [visibility, setVisibility] = useState<PhotoVisibility>('PRIVATE');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [locked, setLocked] = useState(false);
  const active = useRef<AbortController | null>(null), key = useRef('');
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.onerror = () => setError('这张照片暂时无法读取，请重新选择。');
    reader.readAsDataURL(file);
    return () => { if (reader.readyState === FileReader.LOADING) reader.abort(); };
  }, [file]);

  function select(next: File | null) {
    setPreview(''); setError(''); setLocked(false); setVisibility('PRIVATE'); key.current = crypto.randomUUID();
    if (next && (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > profilePhotoMaxBytes || next.size === 0)) {
      setError('请选择 3 MB 以内的 JPEG、PNG 或 WebP 图片。'); setFile(null); return;
    }
    setFile(next);
  }
  return <form className="profile-photo-upload form-stack" onSubmit={async event => {
    event.preventDefault();
    if (!preview || disabled || busy) return;
    const request = new AbortController();
    active.current = request; setBusy(true); setError('');
    try {
      await api<ProfilePhotoDTO>('/me/album', {
        method: 'POST', signal: request.signal, body: { requestKey: key.current, base64: preview.split(',')[1], visibility },
      });
      select(null);
      if (picker.current) picker.current.value = '';
      await saved();
    } catch (e) {
      if (request.signal.aborted) return;
      setError(messageOf(e));
      setLocked(e instanceof ApiError && (e.status === 0 || e.status >= 500));
    } finally {
      if (!request.signal.aborted) setBusy(false);
      if (active.current === request) active.current = null;
    }
  }}>
    <label>选一张照片<input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy}
      onChange={event => select(event.target.files?.[0] ?? null)} /></label>
    {!file && <p className="field-note">最多 {profileAlbumLimit} 张，每张不超过 3 MB。</p>}
    {file && <div className="album-upload-preview">
      {preview && <img src={preview} alt="待上传照片预览" />}
      <label>这张照片谁能看<select value={visibility} disabled={disabled || busy || locked} onChange={event => setVisibility(event.target.value as PhotoVisibility)}>
        {Object.entries(visibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>}
    <FormError>{error}</FormError>
    {busy && <div role="status" className="album-progress"><progress aria-label="正在上传照片" />正在上传照片……</div>}
    {file && <button className="button" disabled={disabled || busy || !preview}><Plus size={17} aria-hidden="true" />{busy ? '正在上传……' : locked ? '核对并重试上传' : '上传照片'}</button>}
  </form>;
}

function PhotoViewer({ photo, index, count, own, close, navigate }: {
  photo: ProfilePhotoDTO; index: number; count: number; own: boolean; close: () => void; navigate: (delta: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog className="album-viewer" ref={ref} aria-label="查看相册照片" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') event.stopPropagation();
      if (event.key === 'ArrowLeft' && index > 0) navigate(-1);
      if (event.key === 'ArrowRight' && index < count - 1) navigate(1);
    }}>
    <header><h2>照片 {index + 1} / {count}</h2><button className="message-icon" type="button" aria-label="关闭照片" onClick={close}><X size={21} /></button></header>
    {failed === photo.id ? <p className="form-note" role="status">照片已不可见或暂时无法读取。</p>
      : <img key={photo.id} src={photoUrl(photo, 'full')} alt={'第 ' + (index + 1) + ' 张相册照片'} onError={() => setFailed(photo.id)} />}
    <div className="button-row">
      <button className="button secondary" type="button" disabled={index === 0} onClick={() => navigate(-1)}><ArrowLeft size={16} />上一张</button>
      <button className="button secondary" type="button" disabled={index === count - 1} onClick={() => navigate(1)}>下一张<ArrowRight size={16} /></button>
    </div>
    {!own && failed !== photo.id && <ReportButton type="PROFILE_PHOTO" id={photo.id} key={photo.id} />}
  </dialog>;
}
