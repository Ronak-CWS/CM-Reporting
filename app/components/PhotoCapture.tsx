'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import AppIcon from './AppIcon';

function usesNativeCamera() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export interface PhotoCaptureHandle { openCamera: () => void }

export default function PhotoCapture({ onCapture, disabled, ref }: { onCapture: (files: File[]) => void; disabled: boolean; ref?: Ref<PhotoCaptureHandle> }) {
  const nativeInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    let stream: MediaStream | undefined;
    let cancelled = false;
    sessionRef.current += 1;
    dialog?.showModal();
    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access needs a supported browser and a secure connection (HTTPS). You can also close this window and upload a photo.');
        }
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          await videoRef.current.play();
        }
      } catch (cameraError) {
        stream?.getTracks().forEach((track) => track.stop());
        if (cancelled) return;
        setError(cameraError instanceof DOMException && cameraError.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser, or close this window and upload a photo.'
          : cameraError instanceof DOMException && cameraError.name === 'NotFoundError'
            ? 'No camera was found. Connect a camera, or close this window and upload a photo.'
            : cameraError instanceof Error ? cameraError.message : 'The camera could not be opened. You can upload a photo instead.');
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      sessionRef.current += 1;
      stream?.getTracks().forEach((track) => track.stop());
      dialog?.close();
    };
  }, [open]);

  function takePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || capturing) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { setError('The photo could not be captured. Please try uploading a photo.'); return; }
    setCapturing(true);
    const captureSession = sessionRef.current;
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (sessionRef.current !== captureSession) return;
      setCapturing(false);
      if (!blob) { setError('The photo could not be captured. Please try again.'); return; }
      onCapture([new File([blob], `blockage-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
      setOpen(false);
    }, 'image/jpeg', 0.9);
  }

  const openCamera = useCallback(() => {
    if (disabled) return;
    if (usesNativeCamera()) { nativeInput.current?.click(); return; }
    setError(''); setReady(false); setCapturing(false); setOpen(true);
  }, [disabled]);
  useImperativeHandle(ref, () => ({ openCamera }), [openCamera]);

  return <>
    <input ref={nativeInput} className="sr-only" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-label="Take a blockage photo" disabled={disabled} onChange={(event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length) onCapture(files);
    }} />
    <button className="button button--primary" type="button" disabled={disabled} onClick={openCamera}><AppIcon name="camera" />Take photo</button>
    <dialog ref={dialogRef} className="driver-camera" aria-labelledby="camera-title" onCancel={() => setOpen(false)}>
      <div className="driver-camera-heading"><h2 id="camera-title">Take a blockage photo</h2><button className="driver-exit" type="button" onClick={() => setOpen(false)}>Close camera</button></div>
      {error ? <p className="driver-error" role="alert">{error}</p> : <p role="status">{ready ? 'Frame the blockage, then capture your photo.' : 'Waiting for camera access…'}</p>}
      <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" onLoadedData={() => setReady(true)} />
      <button className="button button--primary button--wide" type="button" onClick={takePhoto} disabled={!ready || capturing || Boolean(error)}>{capturing ? 'Capturing…' : 'Capture photo'}</button>
    </dialog>
  </>;
}
