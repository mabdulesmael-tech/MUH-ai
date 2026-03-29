import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode, memo, lazy, Suspense, useCallback } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Sparkles, Loader2, Trash2, Plus, Paperclip, ChevronDown, Globe, Mic, Square, Volume2, Menu, X, MessageSquare, History } from 'lucide-react';

// Lazy load ReactMarkdown to reduce initial bundle size
const ReactMarkdown = lazy(() => import('react-markdown'));

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
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
const genAI = new GoogleGenAI({ apiKey });

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  attachedImageUrl?: string;
  attachedAudioUrl?: string;
  timestamp: Date;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date;
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
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [tempName, setTempName] = useState('');
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load sessions and username from localStorage on mount
  useEffect(() => {
    const savedName = localStorage.getItem('muh_ai_username');
    if (savedName) {
      setUserName(savedName);
    } else {
      setIsNameModalOpen(true);
    }

    const savedSessions = localStorage.getItem('muh_ai_sessions');
    if (savedSessions) {
      try {
        const parsed = JSON.parse(savedSessions);
        // Convert string dates back to Date objects
        const formatted = parsed.map((s: any) => ({
          ...s,
          updatedAt: new Date(s.updatedAt),
          messages: s.messages.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp)
          }))
        }));
        setSessions(formatted);
        if (formatted.length > 0) {
          setActiveSessionId(formatted[0].id);
        }
      } catch (e) {
        console.error("Error parsing saved sessions", e);
      }
    }
  }, []);

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('muh_ai_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  const saveUserName = useCallback(() => {
    if (tempName.trim()) {
      setUserName(tempName.trim());
      localStorage.setItem('muh_ai_username', tempName.trim());
      setIsNameModalOpen(false);
      window.location.reload();
    }
  }, [tempName]);

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

  const createNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'Nova conversa',
      messages: [],
      updatedAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setIsSidebarOpen(false);
  }, []);

  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== id);
      if (newSessions.length === 0) {
        localStorage.removeItem('muh_ai_sessions');
      }
      return newSessions;
    });
    setActiveSessionId(prev => prev === id ? (sessions.length > 1 ? sessions.find(s => s.id !== id)?.id || null : null) : prev);
  }, [sessions]);

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
    if ((!input.trim() && !selectedFile) || isLoading) return;

    // Ensure we have an active session
    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: input.trim().substring(0, 30) || 'Nova conversa',
        messages: [],
        updatedAt: new Date(),
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      currentSessionId = newSession.id;
    }

    // Check if API key is configured
    if (!import.meta.env.VITE_GEMINI_API_KEY) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: "⚠️ **Configuração Necessária:** A chave de API (`VITE_GEMINI_API_KEY`) não foi encontrada. No Cloudflare Pages, adicione-a em 'Environment variables' nas configurações de build.",
        timestamp: new Date(),
      };
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId ? { ...s, messages: [...s.messages, errorMsg] } : s
      ));
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

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim() || (selectedFile ? (selectedFile.type.startsWith('image/') ? "Analise esta imagem." : "Analise este áudio.") : ""),
      attachedImageUrl,
      attachedAudioUrl,
      timestamp: new Date(),
    };

    // Update session with user message and title if it's the first message
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        const isFirstMessage = s.messages.length === 0;
        return {
          ...s,
          title: isFirstMessage ? (input.trim().substring(0, 40) || 'Conversa com anexo') : s.title,
          messages: [...s.messages, userMessage],
          updatedAt: new Date()
        };
      }
      return s;
    }));

    const currentInput = input.trim();
    setInput('');
    setSelectedFile(null);
    
    setIsLoading(true);

    try {
      const assistantMessageId = (Date.now() + 1).toString();
      let assistantContent = "";

      setSessions(prev => prev.map(s => 
        s.id === currentSessionId ? { 
          ...s, 
          messages: [...s.messages, {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
          }] 
        } : s
      ));

      // Prepare history from the current state of the session
      // We use the functional update pattern or a ref to get the most recent state if needed,
      // but here we can just use the current session messages.
      const history = messages.slice(-10).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const currentParts: any[] = [{ text: userMessage.content }];
      if (filePart) {
        currentParts.push(filePart);
      }

      const response = await genAI.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [
          ...history,
          { role: 'user', parts: currentParts }
        ],
        config: {
          systemInstruction: `Você é a MUH ai, uma IA rápida e eficiente. O nome do usuário é ${userName || 'Utilizador'}. Trate-o de forma amigável e personalizada. Responda em português brasileiro de forma direta e completa, sem cortar o texto. Use markdown.`,
          maxOutputTokens: 4096,
        }
      });

      for await (const chunk of response) {
        const chunkText = chunk.text || "";
        if (!chunkText) continue;
        assistantContent += chunkText;
        
        setSessions(prev => prev.map(s => 
          s.id === currentSessionId ? {
            ...s,
            messages: s.messages.map(m => 
              m.id === assistantMessageId ? { ...m, content: assistantContent } : m
            )
          } : s
        ));
      }

    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      let errorMessage = "Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.";
      
      if (error?.message?.includes("API key not valid")) {
        errorMessage = "⚠️ **Chave de API Inválida:** A chave de API configurada não é válida. Verifique as configurações no painel do Vercel.";
      } else if (error?.message?.includes("Quota exceeded")) {
        errorMessage = "⚠️ **Limite Atingido:** O limite de uso da API foi excedido. Tente novamente mais tarde.";
      } else if (error?.message?.includes("Model not found")) {
        errorMessage = "⚠️ **Modelo não encontrado:** O modelo selecionado não está disponível ou o nome está incorreto.";
      }

      setSessions(prev => prev.map(s => 
        s.id === currentSessionId ? {
          ...s,
          messages: [...s.messages, {
            id: Date.now().toString(),
            role: 'assistant',
            content: errorMessage,
            timestamp: new Date(),
          }]
        } : s
      ));
    } finally {
      setIsLoading(false);
    }
  }, [input, selectedFile, isLoading, activeSessionId, sessions, messages, userName]);

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
            <div className={`flex items-center gap-2 px-2 mb-2 ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <History className="w-4 h-4 text-gray-500 flex-shrink-0" />
              {!isSidebarCollapsed && <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Histórico</span>}
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
              <div className="w-8 h-8 rounded-full bg-brand-accent/20 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-brand-accent" />
              </div>
              {!isSidebarCollapsed && (
                <>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs font-medium truncate">{userName || 'Utilizador'}</p>
                    <p className="text-[10px] text-gray-500">Plano Grátis</p>
                  </div>
                  <button 
                    onClick={() => setIsNameModalOpen(true)}
                    className="p-1.5 hover:bg-white/5 rounded-lg text-gray-600 hover:text-white transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 rotate-45" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Name Modal */}
      <AnimatePresence>
        {isNameModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-brand-surface border border-brand-border rounded-2xl p-8 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center mb-8">
                <div className="w-16 h-16 bg-brand-accent/10 rounded-2xl flex items-center justify-center mb-4 border border-brand-accent/20">
                  <Bot className="w-8 h-8 text-brand-accent" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">Bem-vindo à MUH ai</h3>
                <p className="text-gray-400 text-sm">Como é que eu te devo chamar?</p>
              </div>
              
              <div className="space-y-4">
                <div className="neon-border-container">
                  <input 
                    type="text" 
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveUserName()}
                    placeholder="O teu nome..."
                    className="w-full p-4 bg-brand-surface border-none focus:ring-0 text-white placeholder-gray-600 rounded-[15px] text-center text-lg"
                  />
                </div>
                <button 
                  onClick={saveUserName}
                  disabled={!tempName.trim()}
                  className="w-full py-4 bg-brand-accent text-white font-bold rounded-xl hover:bg-brand-accent/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                >
                  Confirmar Nome
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
                  {greeting}, {userName?.split(' ')[0] || 'Utilizador'}!
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
