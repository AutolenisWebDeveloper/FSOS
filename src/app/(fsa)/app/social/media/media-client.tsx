'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, Loader2, Trash2, ImageIcon, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Measure image/video dimensions (and video duration) IN-BROWSER so the server can
// validate against per-platform rules without a heavy server-side media library.
async function measure(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith('image/')) {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('load'))
        img.src = url
      })
      return { width: img.naturalWidth, height: img.naturalHeight }
    }
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      await new Promise<void>((res, rej) => {
        v.onloadedmetadata = () => res()
        v.onerror = () => rej(new Error('load'))
        v.src = url
      })
      return { width: v.videoWidth, height: v.videoHeight, duration: v.duration }
    }
    return {}
  } catch {
    return {}
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function MediaUploader() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [altText, setAltText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function upload() {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const dims = await measure(file)
      const fd = new FormData()
      fd.set('file', file)
      if (altText) fd.set('alt_text', altText)
      if (dims.width) fd.set('width', String(dims.width))
      if (dims.height) fd.set('height', String(dims.height))
      if (dims.duration) fd.set('duration_seconds', String(Math.round(dims.duration)))
      const resp = await fetch('/api/social/media/upload', { method: 'POST', body: fd })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setError(body.error || 'Upload failed. Please try again.')
        return
      }
      setFile(null)
      setAltText('')
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-shell-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <UploadCloud className="h-4 w-4 text-primary" aria-hidden />
        Upload an asset
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Images (PNG, JPEG, WebP) or video (MP4, MOV). Stored privately — never a public URL. Add alt text for accessibility.
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="media-file">File</Label>
          <input
            ref={inputRef}
            id="media-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-shell-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <div>
          <Label htmlFor="media-alt">Alt text</Label>
          <Input id="media-alt" value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Describe the image for screen readers" />
        </div>
        {error ? (
          <p className="text-sm text-status-lost" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button size="sm" onClick={upload} disabled={busy || !file}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <UploadCloud className="mr-1 h-4 w-4" aria-hidden />}
            Upload
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DeleteAsset({ id, fileName }: { id: string; fileName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  function remove() {
    start(async () => {
      const resp = await fetch(`/api/social/media/${id}`, { method: 'DELETE' })
      if (resp.ok) router.refresh()
      setConfirming(false)
    })
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete ${fileName}`}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Delete'}
      </Button>
    </div>
  )
}

export function AssetThumb({ kind, url, alt }: { kind: string; url: string | null; alt: string }) {
  if (url && kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
    return <img src={url} alt={alt} className="h-32 w-full rounded-md object-cover" />
  }
  return (
    <div className="flex h-32 w-full items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
      {kind === 'video' ? <Film className="h-8 w-8" aria-hidden /> : <ImageIcon className="h-8 w-8" aria-hidden />}
    </div>
  )
}
