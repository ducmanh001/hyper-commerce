'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/store/auth';
import { Heart, Send, Gift, Users, ShoppingBag, Share2 } from 'lucide-react';
import { toast } from 'react-toastify';

interface Comment {
  id: string;
  fullName: string;
  message: string;
  type: string;
  createdAt: string;
}

const GATEWAY_WS = process.env.NEXT_PUBLIC_GATEWAY_WS ?? 'http://localhost:4000';

const DEMO_COMMENTS = [
  { fullName: 'Minh Anh', message: '🔥 Sản phẩm đẹp quá!' },
  { fullName: 'Thu Hương', message: 'Giá có thể giảm thêm không ạ?' },
  { fullName: 'Nam Phong', message: 'Chất lượng tuyệt vời 👏' },
  { fullName: 'Lan Chi', message: '❤️ Theo dõi kênh này lâu rồi' },
  { fullName: 'Đức Anh', message: 'Ship HN bao nhiêu ngày vậy?' },
];

export default function LiveViewerPage() {
  const { id: streamId } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);

  const socketRef = useRef<Socket | null>(null);
  const peerRef   = useRef<RTCPeerConnection | null>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);

  const [comments, setComments]         = useState<Comment[]>([]);
  const [input, setInput]               = useState('');
  const [viewerCount, setViewerCount]   = useState(0);
  const [liked, setLiked]               = useState(false);
  const [likeCount, setLikeCount]       = useState(0);
  const [connected, setConnected]       = useState(false);
  const [streamStatus, setStreamStatus] = useState<'live'|'ended'|'loading'>('loading');
  const [streamInfo, setStreamInfo]     = useState<{ title: string; hostName: string } | null>(null);
  const [socketToken, setSocketToken]   = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const addComment = useCallback((c: Comment) => {
    setComments(prev => [...prev.slice(-100), c]);
    setTimeout(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, 50);
  }, []);

  // ── Load stream info ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${GATEWAY_WS}/api/live-streams/${streamId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setStreamInfo({ title: data.title, hostName: data.hostName ?? 'Seller' });
          setViewerCount(data.viewerCount ?? 0);
          if (data.status === 'LIVE') setStreamStatus('live');
          // Restore recent comments from DB
          if (data.comments) setComments(data.comments.reverse());
        }
      })
      .catch(() => {});
  }, [streamId]);

  useEffect(() => {
    if (!user) {
      setSocketToken(null);
      return;
    }

    fetch('/api/auth/socket-token', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSocketToken(data?.accessToken ?? null))
      .catch(() => setSocketToken(null));
  }, [user]);

  // ── WebRTC + Socket.IO ────────────────────────────────────────────────────
  useEffect(() => {
    if (!socketToken) return;

    const socket = io(GATEWAY_WS, {
      auth: { token: socketToken },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_stream', { streamId, role: 'viewer' });
    });

    socket.on('disconnect', () => setConnected(false));

    // Viewer count
    socket.on('viewer_count', ({ count }: { count: number }) => setViewerCount(count));

    // Stream ended
    socket.on('stream_ended', () => {
      setStreamStatus('ended');
      toast.info('Live stream đã kết thúc');
    });

    // ── WebRTC: receive offer from broadcaster ──────────────────────────────
    socket.on('webrtc_offer', async ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peerRef.current = pc;

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setStreamStatus('live');
          }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate) socket.emit('webrtc_ice', { targetId: from, candidate: e.candidate });
        };

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_answer', { targetId: from, sdp: answer });
      } catch (err) {
        console.error('[WebRTC viewer] offer error', err);
      }
    });

    // ICE from broadcaster
    socket.on('webrtc_ice', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try { await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    });

    // Real-time comments
    socket.on('new_comment', (c: Comment) => addComment(c));

    // Gifts
    socket.on('new_gift', ({ fullName, giftType }: { fullName: string; giftType: string }) => {
      toast(`🎁 ${fullName} gửi ${giftType}!`, { autoClose: 3000 });
    });

    // Demo fallback: simulate activity when no real stream
    const demoTimer = setTimeout(() => {
      if (!videoRef.current?.srcObject) {
        let i = 0;
        const interval = setInterval(() => {
          const demo = DEMO_COMMENTS[i % DEMO_COMMENTS.length];
          addComment({ id: `demo-${i}`, fullName: demo.fullName, message: demo.message, type: 'text', createdAt: new Date().toISOString() });
          i++;
        }, 3000);
        return () => clearInterval(interval);
      }
    }, 5000);

    return () => {
      clearTimeout(demoTimer);
      peerRef.current?.close();
      socket.disconnect();
    };
  }, [streamId, socketToken, addComment]);

  const sendComment = () => {
    const msg = input.trim();
    if (!msg) return;
    const comment: Comment = {
      id: `local-${Date.now()}`,
      fullName: user?.fullName ?? 'Bạn',
      message: msg,
      type: 'text',
      createdAt: new Date().toISOString(),
    };
    // Show immediately locally
    addComment(comment);
    // Send to gateway (persists to DB + broadcasts)
    socketRef.current?.emit('send_comment', { streamId, message: msg });
    setInput('');
  };

  const sendGift = (type: string) => {
    socketRef.current?.emit('send_gift', { streamId, giftType: type, amount: 1 });
    toast(`🎁 Đã gửi ${type}!`);
  };

  return (
    <div className="flex h-screen bg-black text-white overflow-hidden">
      {/* ── Video area ── */}
      <div className="relative flex-1 flex items-center justify-center bg-gray-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          className="w-full h-full object-cover"
        />

        {/* Overlay when no stream */}
        {streamStatus !== 'live' && !videoRef.current?.srcObject && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            {streamStatus === 'loading' && <div className="text-gray-400 text-lg animate-pulse">Đang tải...</div>}
            {streamStatus === 'ended'   && <div className="text-red-400 text-2xl">⛔ Live đã kết thúc</div>}
          </div>
        )}

        {/* Top info */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <div className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full text-sm font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </div>
          <div className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full text-sm flex items-center gap-1.5">
            <Users size={14} /> {viewerCount.toLocaleString()}
          </div>
        </div>

        {/* Host info */}
        <div className="absolute bottom-24 left-4">
          <p className="font-bold text-lg drop-shadow">{streamInfo?.hostName ?? '...'}</p>
          <p className="text-sm text-gray-300 drop-shadow">{streamInfo?.title ?? ''}</p>
        </div>

        {/* Action buttons */}
        <div className="absolute right-4 bottom-32 flex flex-col gap-4">
          <button
            onClick={() => { setLiked(!liked); setLikeCount(c => c + (liked ? -1 : 1)); }}
            className={`flex flex-col items-center gap-1 ${liked ? 'text-red-500' : 'text-white'}`}
          >
            <Heart size={28} fill={liked ? 'currentColor' : 'none'} />
            <span className="text-xs">{likeCount}</span>
          </button>
          <button onClick={() => sendGift('🌹 Hoa hồng')} className="flex flex-col items-center gap-1 text-yellow-400">
            <Gift size={28} />
            <span className="text-xs">Quà</span>
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(window.location.href); toast('Đã copy link!'); }}
            className="flex flex-col items-center gap-1 text-white"
          >
            <Share2 size={24} />
            <span className="text-xs">Chia sẻ</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-white">
            <ShoppingBag size={24} />
            <span className="text-xs">Shop</span>
          </button>
        </div>
      </div>

      {/* ── Chat panel ── */}
      <div className="w-80 flex flex-col border-l border-gray-800 bg-gray-950">
        {/* Chat messages */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {comments.length === 0 && (
            <p className="text-gray-600 text-sm text-center mt-8">Chưa có bình luận nào</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="text-sm">
              <span className="font-semibold text-orange-400">{c.fullName}: </span>
              <span className="text-gray-200">{c.message}</span>
            </div>
          ))}
        </div>

        {/* Connection status */}
        <div className={`px-3 py-1 text-xs text-center ${connected ? 'text-green-500' : 'text-red-400'}`}>
          {connected ? '🟢 Đang kết nối' : '🔴 Mất kết nối'}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-800 flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendComment()}
            placeholder={user ? 'Nhập bình luận...' : 'Đăng nhập để comment'}
            disabled={!user}
            className="flex-1 bg-gray-800 text-white text-sm rounded-full px-4 py-2 outline-none placeholder-gray-500 disabled:opacity-50"
          />
          <button
            onClick={sendComment}
            disabled={!input.trim() || !user}
            className="bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-full w-9 h-9 flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
