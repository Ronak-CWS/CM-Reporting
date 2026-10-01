// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoCapture from '../app/components/PhotoCapture';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('photo capture', () => {
  it('requests native rear-camera capture on a phone', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android', platform: 'Linux', maxTouchPoints: 1 });
    render(<PhotoCapture disabled={false} onCapture={vi.fn()} />);
    const input = screen.getByLabelText('Take a blockage photo', { selector: 'input' });
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('captures an image on desktop and stops the camera afterwards', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'Win32', mediaDevices: { getUserMedia } });
    const onCapture = vi.fn();
    render(<PhotoCapture disabled={false} onCapture={onCapture} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    const video = screen.getByLabelText('Camera preview');
    Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 } });
    fireEvent.loadedData(video);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['image'], { type: 'image/jpeg' })));
    await user.click(screen.getByRole('button', { name: 'Capture photo' }));
    expect(onCapture.mock.calls[0][0][0]).toBeInstanceOf(File);
    expect(onCapture.mock.calls[0][0][0].type).toBe('image/jpeg');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
  });
  it('stops a camera granted after the driver has already closed the dialog', async () => {
    let grant: (value: unknown) => void = () => {};
    const stop = vi.fn();
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'Win32', mediaDevices: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } });
    render(<PhotoCapture disabled={false} onCapture={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    await act(async () => { grant({ getTracks: () => [{ stop }] }); });
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('explains denied camera permission and keeps the form usable', async () => {
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'Win32', mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } });
    render(<PhotoCapture disabled={false} onCapture={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Camera permission was denied');
    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    expect(screen.getByRole('button', { name: 'Take photo' })).toHaveProperty('disabled', false);
  });

  it('discards a late capture from a closed camera session after reopening', async () => {
    const getUserMedia = vi.fn().mockImplementation(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'Win32', mediaDevices: { getUserMedia } });
    const onCapture = vi.fn();
    render(<PhotoCapture disabled={false} onCapture={onCapture} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    const video = screen.getByLabelText('Camera preview');
    Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 } });
    fireEvent.loadedData(video);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    let finishCapture: BlobCallback = () => {};
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { finishCapture = callback; });
    await user.click(screen.getByRole('button', { name: 'Capture photo' }));
    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await act(async () => { finishCapture(new Blob(['late-image'], { type: 'image/jpeg' })); });
    expect(onCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
