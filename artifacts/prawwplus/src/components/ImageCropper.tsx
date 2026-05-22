import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, Check, RotateCcw } from "lucide-react";

interface Props {
  src: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

const CONTAINER = 268;
const OUTPUT    = 600;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function ImageCropper({ src, onConfirm, onCancel }: Props) {
  const imgRef      = useRef<HTMLImageElement>(null);
  const [ready,     setReady]     = useState(false);
  const [zoom,      setZoom]      = useState(1);
  const [offset,    setOffset]    = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  const baseScale = useCallback(() => {
    const img = imgRef.current;
    if (!img || img.naturalWidth === 0) return 1;
    return Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight);
  }, []);

  const limits = useCallback((z: number) => {
    const img = imgRef.current;
    if (!img) return { mx: 0, my: 0 };
    const s = baseScale() * z;
    return {
      mx: Math.max(0, (img.naturalWidth  * s - CONTAINER) / 2),
      my: Math.max(0, (img.naturalHeight * s - CONTAINER) / 2),
    };
  }, [baseScale]);

  const clampedOffset = (ox: number, oy: number, z: number) => {
    const { mx, my } = limits(z);
    return { x: clamp(ox, -mx, mx), y: clamp(oy, -my, my) };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampedOffset(dragRef.current.ox + dx, dragRef.current.oy + dy, zoom));
  };

  const handlePointerUp = () => { dragRef.current = null; };

  const handleZoomChange = (newZ: number) => {
    const z = clamp(newZ, 1, 4);
    setZoom(z);
    setOffset((prev) => clampedOffset(prev.x, prev.y, z));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    handleZoomChange(zoom - e.deltaY * 0.003);
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img || img.naturalWidth === 0) return;
    const s = baseScale() * zoom;
    const centerX = img.naturalWidth  / 2 - offset.x / s;
    const centerY = img.naturalHeight / 2 - offset.y / s;
    const half    = CONTAINER / 2 / s;
    const sx = Math.max(0, centerX - half);
    const sy = Math.max(0, centerY - half);
    const sw = Math.min(img.naturalWidth  - sx, half * 2);
    const sh = Math.min(img.naturalHeight - sy, half * 2);

    const canvas = document.createElement("canvas");
    canvas.width  = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT, OUTPUT);
    onConfirm(canvas.toDataURL("image/jpeg", 0.82));
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const s = baseScale() * zoom;
  const img = imgRef.current;
  const displayW = img ? img.naturalWidth  * s : CONTAINER;
  const displayH = img ? img.naturalHeight * s : CONTAINER;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 20000,
        background: "rgba(0,0,0,0.88)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "20px 20px calc(20px + env(safe-area-inset-bottom,0px))",
      }}
    >
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>

        {/* Header */}
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={onCancel}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X style={{ width: 16, height: 16, color: "#fff" }} />
          </button>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: 0 }}>Crop Photo</p>
          <button
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <RotateCcw style={{ width: 14, height: 14, color: "#fff" }} />
          </button>
        </div>

        {/* Crop canvas */}
        <div style={{ position: "relative" }}>
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            style={{
              width: CONTAINER, height: CONTAINER,
              borderRadius: "50%",
              overflow: "hidden",
              position: "relative",
              cursor: "grab",
              userSelect: "none",
              touchAction: "none",
              background: "#111",
              boxShadow: "0 0 0 3px rgba(255,255,255,0.25), 0 0 0 9999px rgba(0,0,0,0.55)",
            }}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={() => setReady(true)}
              style={{
                position: "absolute",
                width: ready ? displayW : "100%",
                height: ready ? displayH : "100%",
                objectFit: ready ? undefined : "cover",
                top:  "50%",
                left: "50%",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                pointerEvents: "none",
              }}
            />
          </div>

          {/* Grid overlay */}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr 1fr" }}>
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} style={{ border: "0.5px solid rgba(255,255,255,0.15)" }} />
              ))}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", margin: 0 }}>
          Drag to reposition · scroll or pinch to zoom
        </p>

        {/* Zoom control */}
        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => handleZoomChange(zoom - 0.2)}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <ZoomOut style={{ width: 16, height: 16, color: "#fff" }} />
          </button>
          <input
            type="range" min={1} max={4} step={0.01} value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#30d158", cursor: "pointer" }}
          />
          <button
            onClick={() => handleZoomChange(zoom + 0.2)}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <ZoomIn style={{ width: 16, height: 16, color: "#fff" }} />
          </button>
        </div>

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          style={{
            width: "100%", padding: "15px 0", borderRadius: 16,
            background: "linear-gradient(135deg, #30d158, #25a645)",
            border: "none", color: "#fff", fontSize: 16, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: "0 4px 20px rgba(48,209,88,0.35)",
          }}
        >
          <Check style={{ width: 18, height: 18 }} />
          Use This Photo
        </button>
      </div>
    </div>,
    document.body,
  );
}
