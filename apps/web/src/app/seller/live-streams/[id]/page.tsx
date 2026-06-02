'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/store/auth';
import { Video, VideoOff, Mic, MicOff, Users, Send, Copy, ExternalLink, StopCircle } from 'lucide-react';
import { toast } from 'react-toastify';

const GATEWAY_WS = process.env.NEXT_PUBLIC_GATEWAY_WS ?? 'http://localhost:4000';

interface Comment { id: string; fullName: string; message: string; createdAt: string; }

export default function SellerLivePage() {
  const { id: streamId } = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken: token, user } = useAuthStore();

  // Refs
  const socketRef      = useRef<Socket | null>(null);
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef       = useRef<Map<string, RTCPeerConnection>>(new Map());

  // State
  const [isLive, setIsLive]           = useState(false);
  const [cameraOn, setCameraOn]       = useState(false);
  const [micOn, setMicOn]             = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [comments, setComments]       = useState<Comment[]>([]);
  const [input, setInput]             = useState('');
  const [streamInfo, setStreamInfo]   = useState<{ title: string; streamKey: string } | null>(null);
  const [elapsed, setElapsed]         = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);

  const addComment = useCallback((c: Comment) => {
    setComments(prev => [...prev.slice(-100), c]);
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }), 50);
  }, []);

  // ── Load stream info ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${GATEWAY_WS}/api/live-streams/${streamId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStreamInfo({ title: data.title, streamKey: data.streamKey ?? '' }); })
      .catch(() => {});
  }, [streamId]);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;

  // ── Start camera ──────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraOn(true);
      toast.success('Camera đã bật!');
    } catch (err) {
      toast.error('Không thể truy cập camera. Kiểm tra quyền truy cập.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(!micOn);
  };

  // ── Create WebRTC offer for a new viewer ──────────────────────────────────
  const createOfferFor = useCallback(async (viewerId: string, socket: Socket) => {
    if (!localStreamRef.current) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peersRef.current.set(viewerId, pc);

    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('webrtc_ice', { targetId: viewerId, candidate: e.candidate });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { targetId: viewerId, sdp: offer });
  }, []);

  // ── Go live / stop ────────────────────────────────────────────────────────
  const goLive = async () => {
    if (!cameraOn) {
      toast.info('Hãy bật camera trước khi livestream');
      return;
    }

    // Call gateway to update stream status
    const res = await fetch(`${GATEWAY_WS}/api/seller/live-streams/${streamId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast.error('Không thể bắt đầu livestream'); return; }

    // Connect socket
    const socket = io(GATEWAY_WS, {
      auth: { token: token ?? '' },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_stream', { streamId, role: 'broadcaster' });
      setIsLive(true);
      setElapsed(0);
      toast.success('🔴 Bắt đầu livestream!');
    });

    // When a viewer joins → create WebRTC offer for them
    socket.on('viewer_joined', ({ viewerId }: { viewerId: string }) => {
      toast.info('👤 Có người xem mới!', { autoClose: 2000 });
      createOfferFor(viewerId, socket);
    });

    // Viewer answer
    socket.on('webrtc_answer', async ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    // ICE from viewer
    socket.on('webrtc_ice', async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(from);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('viewer_count', ({ count }: { count: number }) => setViewerCount(count));
    socket.on('new_comment', (c: Comment) => addComment(c));
  };

  const stopLive = async () => {
    // Close all peer connections
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    socketRef.current?.disconnect();
    socketRef.current = null;

    await fetch(`${GATEWAY_WS}/api/seller/live-streams/${streamId}/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});

    setIsLive(false);
    toast.info('Live đã kết thúc');
  };

  const sendComment = () => {
    const msg = input.trim();
    if (!msg) return;
    addComment({ id: `me-${Date.now()}`, fullName: user?.fullName ?? 'Seller', message: msg, createdAt: new Date().toISOString() });
    socketRef.current?.emit('send_comment', { streamId, message: msg });
    setInput('');
  };

  const viewerLink = typeof window !== 'undefined' ? `${window.location.origin}/live/${streamId}` : '';

  // Cleanup on unmount
  useEffect(() => () => { stopCamera(); socketRef.current?.disconnect(); }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">🎥 Quản lý Livestream</h1>
            <p className="text-gray-400 text-sm">{streamInfo?.title ?? 'Đang tải...'}</p>
          </div>
          <div className="flex items-center gap-3">
            {isLive && (
              <div className="flex items-center gap-2 bg-red-600 px-4 py-1.5 rounded-full text-sm font-bold">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                LIVE · {fmtTime(elapsed)}
              </div>
            )}
            <div className="flex items-center gap-1 text-gray-400 text-sm">
              <Users size={16} /> {viewerCount} người xem
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Camera preview ── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative aspect-video bg-gray-900 rounded-2xl overflow-hidden">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                  <Video size={64} className="mb-3" />
                  <p className="text-lg">Camera chưa bật</p>
                  <p className="text-sm text-gray-600 mt-1">Bấm &quot;Bật Camera&quot; để bắt đầu</p>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap gap-3">
              {!cameraOn ? (
                <button onClick={startCamera} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-5 py-2.5 rounded-xl font-semibold">
                  <Video size={18} /> Bật Camera
                </button>
              ) : (
                <button onClick={stopCamera} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-5 py-2.5 rounded-xl font-semibold">
                  <VideoOff size={18} /> Tắt Camera
                </button>
              )}

              <button onClick={toggleMic} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold ${micOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-700 hover:bg-red-600'}`}>
                {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                {micOn ? 'Tắt Mic' : 'Bật Mic'}
              </button>

              {!isLive ? (
                <button onClick={goLive} disabled={!cameraOn} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2.5 rounded-xl font-bold text-lg ml-auto">
                  🔴 Bắt đầu Live
                </button>
              ) : (
                <button onClick={stopLive} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-6 py-2.5 rounded-xl font-bold ml-auto">
                  <StopCircle size={18} /> Kết thúc Live
                </button>
              )}
            </div>

            {/* Stream info */}
            <div className="bg-gray-900 rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-gray-300">Thông tin stream</h3>
              <div>
                <label className="text-xs text-gray-500">Link xem trực tiếp</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-gray-800 rounded px-3 py-2 text-sm text-orange-300 truncate">{viewerLink}</code>
                  <button onClick={() => { navigator.clipboard.writeText(viewerLink); toast('Đã copy!'); }} className="text-gray-400 hover:text-white p-2">
                    <Copy size={16} />
                  </button>
                  <a href={viewerLink} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-white p-2">
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Stream Key</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-gray-800 rounded px-3 py-2 text-sm text-gray-400 blur-sm hover:blur-none transition-all truncate">{streamInfo?.streamKey ?? '...'}</code>
                  <button onClick={() => { navigator.clipboard.writeText(streamInfo?.streamKey ?? ''); toast('Đã copy!'); }} className="text-gray-400 hover:text-white p-2">
                    <Copy size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Live chat ── */}
          <div className="flex flex-col bg-gray-900 rounded-2xl overflow-hidden h-[600px]">
            <div className="p-4 border-b border-gray-800 font-semibold">💬 Live Chat</div>
            <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2">
              {comments.length === 0 && (
                <p className="text-gray-600 text-sm text-center mt-8">Chat sẽ xuất hiện ở đây</p>
              )}
              {comments.map(c => (
                <div key={c.id} className="text-sm">
                  <span className="font-semibold text-orange-400">{c.fullName}: </span>
                  <span className="text-gray-200">{c.message}</span>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-gray-800 flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendComment()}
                placeholder="Nhắn tin..."
                className="flex-1 bg-gray-800 text-white text-sm rounded-full px-4 py-2 outline-none"
              />
              <button onClick={sendComment} disabled={!input.trim()} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-full w-9 h-9 flex items-center justify-center">
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
