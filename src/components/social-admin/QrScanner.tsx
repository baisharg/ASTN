import { useEffect, useRef, useState } from 'react'

/**
 * Camera QR scanner. Uses the browser's BarcodeDetector where it exists
 * (Chrome, Android) and falls back to jsQR, loaded only then (Safari/iOS).
 * Calls `onScan` with each code read, at most once per code every 3 s.
 */

type Detector = (source: HTMLVideoElement) => Promise<string | null>

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = {
  new (options: { formats: Array<string> }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<Array<string>>
}

async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector
  if (Native) {
    const formats = (await Native.getSupportedFormats?.()) ?? ['qr_code']
    if (formats.includes('qr_code')) {
      const detector = new Native({ formats: ['qr_code'] })
      return async (video) => {
        const codes = await detector.detect(video)
        return codes[0]?.rawValue ?? null
      }
    }
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return async (video) => {
    if (!context || !video.videoWidth) return null
    // Downscale: faster, and QR codes on a phone screen stay readable.
    const scale = Math.min(1, 640 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(image.data, image.width, image.height)?.data ?? null
  }
}

export function QrScanner({
  onScan,
  onError,
}: {
  onScan: (code: string) => void
  onError: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
  })

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const recent = new Map<string, number>()

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onErrorRef.current('Este navegador no permite usar la cámara.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch {
        onErrorRef.current(
          'No pudimos abrir la cámara. Revisá el permiso del navegador.',
        )
        return
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => undefined)
      let detect: Detector
      try {
        detect = await createDetector()
      } catch {
        onErrorRef.current('No se pudo iniciar el lector de QR.')
        return
      }
      setReady(true)

      const tick = async () => {
        if (stopped) return
        try {
          const code = await detect(video)
          const now = Date.now()
          if (code && (recent.get(code) ?? 0) < now - 3000) {
            recent.set(code, now)
            onScanRef.current(code)
          }
        } catch {
          // A frame that couldn't be read; try the next one.
        }
        timer = setTimeout(() => void tick(), 250)
      }
      void tick()
    }
    void start()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-lg bg-black aspect-square sm:aspect-video">
      <video
        ref={videoRef}
        className="size-full object-cover"
        playsInline
        muted
        aria-label="Vista de la cámara"
      />
      {ready && (
        <div
          className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80"
          aria-hidden
        />
      )}
    </div>
  )
}
