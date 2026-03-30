import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode, memo, lazy, Suspense, useCallback, createContext, useContext } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Sparkles, Loader2, Trash2, Plus, Paperclip, ChevronDown, Globe, Mic, Square, Volume2, Menu, X, MessageSquare, History, LogOut, Mail, Github, Facebook, Apple } from 'lucide-react';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut, 
  User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  Timestamp, 
  deleteDoc, 
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db, googleProvider, facebookProvider, appleProvider } from './firebase';

// Lazy load ReactMarkdown to reduce initial bundle size
const ReactMarkdown = lazy(() => import('react-markdown'));

// Firestore Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-brand-dark text-white p-6 text-center">
          <h2 className="text-2xl font-bold text-red-500 mb-4">Ops! Algo deu errado.</h2>
          <p className="text-gray-400 mb-6 max-w-md">Ocorreu um erro inesperado.</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-brand-accent rounded-lg hover:bg-brand-accent/80 transition-all"
          >
            Recarregar Página
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenAI({ apiKey });

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  attachedImageUrl?: string;
  attachedAudioUrl?: string;
  timestamp: Date | Timestamp;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date | Timestamp;
  userId: string;
}

// Auth Context
const AuthContext = createContext<{
  user: FirebaseUser | null;
  loading: boolean;
} | undefined>(undefined);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
      
      if (user) {
        // Sync user to Firestore
        const userRef = doc(db, 'users', user.uid);
        getDoc(userRef).then((docSnap) => {
          if (!docSnap.exists()) {
            // Create new user
            setDoc(userRef, {
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              photoURL: user.photoURL,
              createdAt: serverTimestamp(),
              role: 'user'
            }).catch(err => handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`));
          } else {
            // Update existing user only if info changed
            const data = docSnap.data();
            const updates: any = {};
            if (data.displayName !== user.displayName) updates.displayName = user.displayName;
            if (data.photoURL !== user.photoURL) updates.photoURL = user.photoURL;
            
            if (Object.keys(updates).length > 0) {
              setDoc(userRef, updates, { merge: true })
                .catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`));
            }
          }
        }).catch(err => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));
      }
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Login Component
function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: any) => {
    setError('');
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-brand-surface border border-brand-border rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-brand-accent/10 rounded-2xl flex items-center justify-center mb-4 border border-brand-accent/20">
            <Bot className="w-8 h-8 text-brand-accent" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">MUH ai</h2>
          <p className="text-gray-400 text-sm">Entre ou crie uma conta para começar</p>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">E-mail</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 bg-brand-dark border border-brand-border rounded-xl text-white focus:ring-1 focus:ring-brand-accent focus:outline-none"
              placeholder="seu@email.com"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Senha</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 bg-brand-dark border border-brand-border rounded-xl text-white focus:ring-1 focus:ring-brand-accent focus:outline-none"
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button 
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-accent text-white font-bold rounded-xl hover:bg-brand-accent/80 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (isSignUp ? 'Criar Conta' : 'Entrar')}
          </button>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-brand-border"></div></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-brand-surface px-2 text-gray-500">Ou continue com</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <button onClick={() => handleSocialLogin(googleProvider)} className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-brand-border rounded-xl hover:bg-white/10 transition-all">
            <Globe className="w-4 h-4 text-white" />
            <span className="text-xs font-medium text-white">Google</span>
          </button>
          <button onClick={() => handleSocialLogin(facebookProvider)} className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-brand-border rounded-xl hover:bg-white/10 transition-all">
            <Facebook className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-white">Facebook</span>
          </button>
          <button onClick={() => handleSocialLogin(appleProvider)} className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-brand-border rounded-xl hover:bg-white/10 transition-all">
            <Apple className="w-4 h-4 text-white" />
            <span className="text-xs font-medium text-white">Apple</span>
          </button>
          <button onClick={() => setIsSignUp(!isSignUp)} className="flex items-center justify-center gap-2 p-3 bg-brand-accent/10 border border-brand-accent/20 rounded-xl hover:bg-brand-accent/20 transition-all">
            <Mail className="w-4 h-4 text-brand-accent" />
            <span className="text-xs font-medium text-brand-accent">{isSignUp ? 'Já tenho conta' : 'Criar conta'}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Memoized Message Item for performance
const MessageItem = memo(({ message }: { message: Message }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className={`flex gap-6 ${message.role === 'assistant' ? '' : 'flex-row-reverse'} message-item`}
  >
    <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-1 ${
      message.role === 'assistant' ? 'bg-brand-accent/10 text-brand-accent border border-brand-accent/20' : 'bg-white/10 text-white border border-white/10'
    }`}>
      {message.role === 'assistant' ? <Bot className="w-5 h-5" /> : <User className="w-4 h-4" />}
    </div>
    <div className={`flex flex-col ${message.role === 'assistant' ? 'max-w-[92%]' : 'max-w-[85%] items-end'}`}>
      <div className={`w-full ${message.role === 'assistant' ? '' : 'bg-white/5 p-4 rounded-2xl border border-brand-border'}`}>
        {message.attachedImageUrl && (
          <div className="mb-3 rounded-lg overflow-hidden border border-white/10 max-w-sm">
            <img 
              src={message.attachedImageUrl} 
              alt="Anexo" 
              className="w-full h-auto object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        {message.attachedAudioUrl && (
          <div className="mb-3 p-4 rounded-2xl bg-brand-accent/5 border border-brand-accent/20 flex flex-col gap-3 max-w-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center flex-shrink-0">
                <Volume2 className="w-5 h-5 text-brand-accent" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium text-brand-accent/80 uppercase tracking-wider">Mensagem de Áudio</p>
                <p className="text-[10px] text-gray-500">Clique para ouvir</p>
              </div>
            </div>
            <audio controls src={message.attachedAudioUrl} className="h-10 w-full custom-audio" />
          </div>
        )}
        <div className="markdown-body">
          <Suspense fallback={<div className="animate-pulse h-4 bg-white/5 rounded w-3/4 mb-2"></div>}>
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </Suspense>
        </div>
        {message.imageUrl && (
          <div className="mt-4 rounded-xl overflow-hidden border border-white/10 shadow-xl">
            <img 
              src={message.imageUrl} 
              alt="Imagem gerada pela MUH ai" 
              className="w-full h-auto object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  </motion.div>
));

MessageItem.displayName = 'MessageItem';

// Memoized Chat Input Component for performance
const ChatInput = memo(({ 
  input, 
  setInput, 
  handleSend, 
  isLoading, 
  placeholder,
  selectedFile,
  setSelectedFile,
  isSmall = false
}: { 
  input: string, 
  setInput: (val: string) => void, 
  handleSend: () => void, 
  isLoading: boolean, 
  placeholder: string,
  selectedFile: File | null,
  setSelectedFile: (file: File | null) => void,
  isSmall?: boolean
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'image' | 'audio' | null>(null);
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  useEffect(() => {
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      setFileType(selectedFile.type.startsWith('image/') ? 'image' : 'audio');
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewUrl(null);
      setFileType(null);
    }
  }, [selectedFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImage = file.type.startsWith('image/');
      const isAudio = file.type.startsWith('audio/');
      
      if (!isImage && !isAudio) {
        alert("Por favor, selecione uma imagem ou um arquivo de áudio.");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        alert("O arquivo é muito grande. O limite é 10MB.");
        return;
      }
      setSelectedFile(file);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert("O seu navegador não suporta gravação de áudio.");
      return;
    }

    try {
      console.log("Solicitando acesso ao microfone...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Acesso concedido.");
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : MediaRecorder.isTypeSupported('audio/mp4') 
          ? 'audio/mp4' 
          : 'audio/ogg';
          
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const extension = mimeType.split('/')[1].split(';')[0];
        const file = new File([audioBlob], `recording-${Date.now()}.${extension}`, { type: mimeType });
        setSelectedFile(file);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Acesso ao microfone negado. Por favor, permita o acesso nas configurações do navegador.");
      } else {
        alert(`Erro ao acessar o microfone: ${err.message || 'Erro desconhecido'}`);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="neon-border-container group">
      <div className={`relative bg-brand-surface rounded-[15px] p-2 shadow-2xl ${isSmall ? '' : 'border border-white/5'}`}>
        {previewUrl && (
          <div className="px-4 pt-4 pb-2">
            <div className="relative inline-block">
              {fileType === 'image' ? (
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="h-20 w-auto rounded-lg border border-white/10 object-cover"
                />
              ) : (
                <div className="h-20 w-40 flex flex-col items-center justify-center bg-white/5 rounded-lg border border-white/10 p-2">
                  <Volume2 className="w-6 h-6 text-brand-accent mb-1" />
                  <span className="text-[10px] text-gray-400 truncate w-full text-center">{selectedFile?.name}</span>
                </div>
              )}
              <button 
                onClick={() => setSelectedFile(null)}
                className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-lg hover:bg-red-600 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
        
        {isRecording ? (
          <div className={`w-full p-4 flex items-center justify-between bg-brand-accent/5 rounded-xl mb-2 animate-pulse ${isSmall ? 'min-h-[56px]' : 'min-h-[100px]'}`}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
              <span className="text-white font-medium tracking-wider">Gravando... {formatDuration(recordingDuration)}</span>
            </div>
            <button 
              onClick={stopRecording}
              className="p-2 bg-red-500/20 text-red-500 rounded-full hover:bg-red-500/30 transition-all"
            >
              <Square className="w-5 h-5 fill-current" />
            </button>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={placeholder}
            className={`w-full p-4 bg-transparent border-none focus:ring-0 focus:outline-none caret-brand-accent text-white placeholder-gray-600 resize-none ${isSmall ? 'min-h-[56px] max-h-40 text-base' : 'min-h-[100px] text-lg'}`}
            rows={1}
          />
        )}

        <div className={`flex items-center justify-between px-2 ${isSmall ? 'pb-1' : 'pb-2'}`}>
          <div className="flex items-center gap-1">
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*,audio/*"
              className="hidden"
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isRecording}
              className={`p-2 rounded-lg transition-all ${selectedFile ? 'text-brand-accent bg-brand-accent/10' : 'text-gray-600 hover:text-brand-accent hover:bg-brand-accent/10 disabled:opacity-50'}`}
            >
              <Paperclip className={isSmall ? "w-4 h-4" : "w-5 h-5"} />
            </button>
            
            <button 
              onClick={startRecording}
              disabled={isRecording || isLoading || !!selectedFile}
              className={`p-2 rounded-lg transition-all text-gray-600 hover:text-brand-accent hover:bg-brand-accent/10 disabled:opacity-50`}
            >
              <Mic className={isSmall ? "w-4 h-4" : "w-5 h-5"} />
            </button>
          </div>
          <button
            onClick={() => handleSend()}
            disabled={(!input.trim() && !selectedFile) || isLoading || isRecording}
            className={`p-2 rounded-xl transition-all ${
              (!input.trim() && !selectedFile) || isLoading || isRecording
                ? 'text-gray-700 bg-white/5' 
                : `text-white bg-brand-accent hover:bg-brand-accent/80 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(168, 85, 247, 0.4)]`
            }`}
          >
            {isLoading ? <Loader2 className={isSmall ? "w-4 h-4 animate-spin" : "w-5 h-5 animate-spin"} /> : <Send className={isSmall ? "w-4 h-4" : "w-5 h-5"} />}
          </button>
        </div>
      </div>
    </div>
  );
});

ChatInput.displayName = 'ChatInput';

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  );
}

function App() {
  const { user, loading: authLoading } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch sessions from Firestore
  useEffect(() => {
    if (!user) return;

    const sessionsRef = collection(db, 'users', user.uid, 'sessions');
    const q = query(sessionsRef, orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedSessions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        updatedAt: (doc.data().updatedAt as Timestamp)?.toDate() || new Date(),
        messages: [] // Messages are fetched separately
      })) as ChatSession[];
      
      setSessions(fetchedSessions);
      
      if (fetchedSessions.length > 0 && !activeSessionId) {
        setActiveSessionId(fetchedSessions[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions`);
    });

    return unsubscribe;
  }, [user]);

  // Fetch messages for active session
  useEffect(() => {
    if (!user || !activeSessionId) return;

    const messagesRef = collection(db, 'users', user.uid, 'sessions', activeSessionId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: (doc.data().timestamp as Timestamp)?.toDate() || new Date()
      })) as Message[];

      setSessions(prev => prev.map(s => 
        s.id === activeSessionId ? { ...s, messages: fetchedMessages } : s
      ));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions/${activeSessionId}/messages`);
    });

    return unsubscribe;
  }, [user, activeSessionId]);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setGreeting('Bom dia');
    else if (hour >= 12 && hour < 18) setGreeting('Boa tarde');
    else if (hour >= 18 && hour < 24) setGreeting('Boa noite');
    else setGreeting('Boa madrugada');
  }, []);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const createNewSession = useCallback(async () => {
    if (!user) return;
    try {
      const sessionsRef = collection(db, 'users', user.uid, 'sessions');
      const newSessionDoc = await addDoc(sessionsRef, {
        title: 'Nova conversa',
        updatedAt: serverTimestamp(),
        userId: user.uid
      });
      setActiveSessionId(newSessionDoc.id);
      setIsSidebarOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
    }
  }, [user]);

  const deleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'sessions', id));
      if (activeSessionId === id) {
        setActiveSessionId(sessions.find(s => s.id !== id)?.id || null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${id}`);
    }
  }, [user, activeSessionId, sessions]);

  const clearAllSessions = useCallback(async () => {
    if (!user) return;
    try {
      const batch = writeBatch(db);
      const sessionsRef = collection(db, 'users', user.uid, 'sessions');
      const snapshot = await getDocs(sessionsRef);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      setSessions([]);
      setActiveSessionId(null);
      setIsClearModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions`);
    }
  }, [user]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !selectedFile) || isLoading || !user) return;

    // Ensure we have an active session
    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      try {
        const sessionsRef = collection(db, 'users', user.uid, 'sessions');
        const newSessionDoc = await addDoc(sessionsRef, {
          title: input.trim().substring(0, 30) || 'Nova conversa',
          updatedAt: serverTimestamp(),
          userId: user.uid
        });
        currentSessionId = newSessionDoc.id;
        setActiveSessionId(currentSessionId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
        return;
      }
    }

    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: "⚠️ **Configuração Necessária:** A chave de API não foi encontrada. Por favor, verifique as configurações do ambiente.",
        timestamp: new Date(),
      };
      // For local UI state only if needed, but we prefer syncing
      return;
    }

    let attachedImageUrl = "";
    let attachedAudioUrl = "";
    let filePart = null;

    if (selectedFile) {
      const isImage = selectedFile.type.startsWith('image/');
      const isAudio = selectedFile.type.startsWith('audio/');
      
      const fileUrl = URL.createObjectURL(selectedFile);
      if (isImage) attachedImageUrl = fileUrl;
      else if (isAudio) attachedAudioUrl = fileUrl;

      try {
        const base64 = await fileToBase64(selectedFile);
        filePart = {
          inlineData: {
            data: base64,
            mimeType: selectedFile.type
          }
        };
      } catch (e) {
        console.error("Error converting file to base64", e);
      }
    }

    const userMessageContent = input.trim() || (selectedFile ? (selectedFile.type.startsWith('image/') ? "Analise esta imagem." : "Analise este áudio.") : "");
    
    try {
      const messagesRef = collection(db, 'users', user.uid, 'sessions', currentSessionId, 'messages');
      await addDoc(messagesRef, {
        role: 'user',
        content: userMessageContent,
        attachedImageUrl,
        attachedAudioUrl,
        timestamp: serverTimestamp()
      });

      // Update session title if it's the first message
      if (messages.length === 0) {
        const sessionRef = doc(db, 'users', user.uid, 'sessions', currentSessionId);
        await setDoc(sessionRef, {
          title: userMessageContent.substring(0, 40),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } else {
        const sessionRef = doc(db, 'users', user.uid, 'sessions', currentSessionId);
        await setDoc(sessionRef, {
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions/${currentSessionId}/messages`);
    }

    const currentInput = input.trim();
    setInput('');
    setSelectedFile(null);
    
    setIsLoading(true);

    try {
      let assistantContent = "";
      const assistantMessageRef = await addDoc(collection(db, 'users', user.uid, 'sessions', currentSessionId, 'messages'), {
        role: 'assistant',
        content: '',
        timestamp: serverTimestamp()
      });

      // Prepare history from the current state of the session
      const filteredMessages = messages.filter(m => m.content && m.content.trim() !== "");
      
      // Ensure history starts with 'user' and alternates roles
      let history: any[] = [];
      let lastRole: string | null = null;
      
      // Take last 10 messages and filter for alternating roles starting with user
      const recentMessages = filteredMessages.slice(-10);
      for (const m of recentMessages) {
        const role = m.role === 'assistant' ? 'model' : 'user';
        if (history.length === 0 && role !== 'user') continue;
        if (role === lastRole) continue;
        
        history.push({
          role,
          parts: [{ text: m.content }]
        });
        lastRole = role;
      }
      
      // Ensure history ends with 'model' so the next message can be 'user'
      if (history.length > 0 && history[history.length - 1].role === 'user') {
        history.pop();
      }

      const currentParts: any[] = [{ text: userMessageContent }];
      if (filePart) {
        currentParts.push(filePart);
      }

      // Retry logic for transient errors
      let retryCount = 0;
      const maxRetries = 2;
      let success = false;

      while (retryCount <= maxRetries && !success) {
        try {
          const response = await genAI.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: [
              ...history,
              { role: 'user', parts: currentParts }
            ],
            config: {
              systemInstruction: `Você é a MUH ai, uma IA rápida e eficiente. O nome do usuário é ${user.displayName || 'Utilizador'}. Trate-o de forma amigável e personalizada. Responda em português brasileiro de forma direta e completa, sem cortar o texto. Use markdown.`,
            }
          });

          for await (const chunk of response) {
            if (chunk.candidates?.[0]?.finishReason === 'SAFETY' || chunk.candidates?.[0]?.finishReason === 'OTHER') {
              assistantContent += "\n\n⚠️ *[Resposta interrompida por filtros de segurança ou erro técnico]*";
              break;
            }

            const chunkText = chunk.text || "";
            if (!chunkText) continue;
            assistantContent += chunkText;
            
            // Update assistant message in Firestore
            await setDoc(assistantMessageRef, {
              content: assistantContent
            }, { merge: true });
          }
          success = true;
        } catch (error: any) {
          console.error(`Attempt ${retryCount + 1} failed:`, error);
          retryCount++;
          if (retryCount > maxRetries) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }
    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      let errorMessage = "Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.";
      
      if (error?.message?.includes("API key not valid")) {
        errorMessage = "⚠️ **Chave de API Inválida:** A chave de API configurada não é válida.";
      } else if (error?.message?.includes("Quota exceeded")) {
        errorMessage = "⚠️ **Limite Atingido:** O limite de uso da API foi excedido.";
      }

      try {
        await addDoc(collection(db, 'users', user.uid, 'sessions', currentSessionId, 'messages'), {
          role: 'assistant',
          content: errorMessage,
          timestamp: serverTimestamp()
        });
      } catch (e) {
        console.error("Error saving error message:", e);
      }
    } finally {
      setIsLoading(false);
    }
  }, [input, selectedFile, isLoading, activeSessionId, sessions, messages, user]);

  if (authLoading) {
    return (
      <div className="h-screen bg-brand-dark flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-brand-accent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex h-screen bg-brand-dark text-gray-200 overflow-hidden">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 bg-brand-surface border-r border-brand-border z-50 transform transition-all duration-300 ease-in-out will-change-transform ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      } ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'} w-72`}>
        <div className="flex flex-col h-full p-4 relative">
          <div className={`flex items-center mb-6 ${isSidebarCollapsed ? 'lg:justify-center' : 'justify-between'}`}>
            {/* Collapse Toggle Arrow at Top Left */}
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="hidden lg:flex p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-all"
              title={isSidebarCollapsed ? "Expandir" : "Recolher"}
            >
              <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isSidebarCollapsed ? '-rotate-90' : 'rotate-90'}`} />
            </button>
            
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-brand-accent/15 rounded-lg flex items-center justify-center border border-brand-accent/30">
                  <Bot className="w-4 h-4 text-brand-accent" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-white uppercase tracking-[0.2em] leading-none">MUH AI</span>
                  <span className="text-[8px] text-brand-accent font-medium uppercase tracking-widest">Online</span>
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={createNewSession}
            className={`flex items-center gap-3 w-full p-3 rounded-xl border border-brand-border hover:bg-white/5 transition-all mb-6 group ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}
          >
            <Plus className="w-5 h-5 text-brand-accent group-hover:scale-110 transition-transform flex-shrink-0" />
            {!isSidebarCollapsed && <span className="text-sm font-medium whitespace-nowrap">Nova conversa</span>}
          </button>

          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar overflow-x-hidden">
            <div className={`flex items-center justify-between px-2 mb-2 ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-gray-500 flex-shrink-0" />
                {!isSidebarCollapsed && <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Histórico</span>}
              </div>
              {!isSidebarCollapsed && sessions.length > 0 && (
                <button 
                  onClick={() => setIsClearModalOpen(true)}
                  className="text-[10px] text-red-500/70 hover:text-red-500 font-bold uppercase tracking-wider transition-colors"
                >
                  Limpar tudo
                </button>
              )}
            </div>
            {sessions.length === 0 ? (
              !isSidebarCollapsed && <p className="text-xs text-gray-600 px-2 py-4 italic">Nenhuma conversa guardada.</p>
            ) : (
              sessions.map(session => (
                <div 
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setIsSidebarOpen(false);
                  }}
                  title={session.title}
                  className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    activeSessionId === session.id 
                      ? 'bg-brand-accent/10 border border-brand-accent/20 text-white' 
                      : 'hover:bg-white/5 border border-transparent text-gray-400 hover:text-gray-200'
                  } ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <MessageSquare className={`w-4 h-4 flex-shrink-0 ${activeSessionId === session.id ? 'text-brand-accent' : 'text-gray-600'}`} />
                    {!isSidebarCollapsed && <span className="text-sm truncate font-medium">{session.title}</span>}
                  </div>
                  {!isSidebarCollapsed && (
                    <button 
                      onClick={(e) => deleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="pt-4 border-t border-brand-border mt-4">
            <div className={`flex items-center gap-3 p-2 ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-brand-accent/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-4 h-4 text-brand-accent" />
                )}
              </div>
              {!isSidebarCollapsed && (
                <>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs font-medium truncate">{user.displayName || user.email?.split('@')[0] || 'Utilizador'}</p>
                    <p className="text-[10px] text-gray-500">Plano Grátis</p>
                  </div>
                  <button 
                    onClick={() => signOut(auth)}
                    className="p-1.5 hover:bg-white/5 rounded-lg text-gray-600 hover:text-white transition-colors"
                    title="Sair"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Name Modal removed as we use Auth */}

      {/* Clear History Confirmation Modal */}
      <AnimatePresence>
        {isClearModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsClearModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-brand-surface border border-brand-border rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mb-4 border border-red-500/20">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2 tracking-tight">Limpar Histórico?</h3>
                <p className="text-gray-400 text-sm">Esta ação não pode ser desfeita. Todas as suas conversas serão apagadas permanentemente.</p>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsClearModalOpen(false)}
                  className="flex-1 py-3 bg-white/5 text-white font-medium rounded-xl hover:bg-white/10 transition-all border border-white/5"
                >
                  Cancelar
                </button>
                <button 
                  onClick={clearAllSessions}
                  className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                >
                  Limpar Tudo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-brand-dark/80 backdrop-blur-md border-b border-brand-border sticky top-0 z-10">
          <div className="flex items-center gap-3 group cursor-default">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500 hover:text-white lg:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-accent/15 rounded-xl flex items-center justify-center border border-brand-accent/30 overflow-hidden logo-glow transition-transform group-hover:scale-105">
                <Bot className="w-5 h-5 text-brand-accent" />
              </div>
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-bold text-white uppercase tracking-[0.2em] leading-none">MUH AI</span>
                <span className="text-[8px] text-brand-accent font-medium uppercase tracking-widest">Online</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-2 py-1 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
              <span className="text-sm font-medium text-gray-400 tracking-tight">
                {activeSession?.title || 'Conversa'}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-600" />
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto w-full px-4 py-8">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <motion.h2 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-4xl font-semibold text-white mb-12 tracking-tight"
                >
                  {greeting}, {user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'Utilizador'}!
                </motion.h2>
                
                <div className="w-full max-w-2xl">
                  <ChatInput 
                    input={input}
                    setInput={setInput}
                    handleSend={handleSend}
                    isLoading={isLoading}
                    placeholder="Comece uma nova conversa..."
                    selectedFile={selectedFile}
                    setSelectedFile={setSelectedFile}
                  />
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
                    {[
                      { icon: "📝", label: "Resumir texto" },
                      { icon: "💻", label: "Explicar código" },
                      { icon: "🎨", label: "Ideias criativas" },
                      { icon: "📊", label: "Analisar dados" }
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => setInput(item.label)}
                        className="flex flex-col items-center gap-2 p-4 bg-white/5 border border-brand-border rounded-xl hover:bg-white/10 hover:border-brand-accent/30 transition-all group"
                      >
                        <span className="text-xl group-hover:scale-110 transition-transform">{item.icon}</span>
                        <span className="text-xs font-medium text-gray-500 group-hover:text-gray-300 transition-colors">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-12 pb-80">
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <MessageItem key={message.id} message={message} />
                  ))}
                </AnimatePresence>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Persistent Input Area (only when chatting) */}
        {messages.length > 0 && (
          <div className={`fixed bottom-0 left-0 right-0 ${isSidebarCollapsed ? 'lg:left-20' : 'lg:left-72'} bg-gradient-to-t from-brand-dark via-brand-dark to-transparent pt-12 pb-6 px-4 transition-all duration-300`}>
            <div className="max-w-3xl mx-auto">
              <ChatInput 
                input={input}
                setInput={setInput}
                handleSend={handleSend}
                isLoading={isLoading}
                placeholder="Responda à MUH ai..."
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                isSmall={true}
              />
              <p className="text-[10px] text-center text-gray-600 mt-3 font-medium">
                MUH ai pode cometer erros. Considere verificar informações importantes.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
