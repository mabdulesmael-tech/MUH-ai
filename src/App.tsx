import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode, memo, lazy, Suspense, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Sparkles, Loader2, Trash2, Plus, Paperclip, ChevronDown, Globe, Mic, Square, Volume2, Menu, X, MessageSquare, History, LogOut, AlertCircle } from 'lucide-react';

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
const getGenAI = () => {
  const apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || 
                 (import.meta.env?.VITE_GEMINI_API_KEY) || 
                 "";
  if (!apiKey) {
    console.warn("GEMINI_API_KEY not found in environment.");
  }
  return new GoogleGenAI({ apiKey });
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  attachedImageUrl?: string;
  attachedAudioUrl?: string;
  timestamp: string; // ISO string for local storage
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string; // ISO string for local storage
}

// Local Storage Keys
const STORAGE_KEY = 'muh_ai_data';

interface LocalData {
  nickname: string | null;
  sessions: ChatSession[];
  activeSessionId: string | null;
}

const loadData = (): LocalData => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error loading data from localStorage", e);
  }
  return { nickname: null, sessions: [], activeSessionId: null };
};

const saveData = (data: LocalData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Error saving data to localStorage", e);
  }
};

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
            <ReactMarkdown>{message.content || ""}</ReactMarkdown>
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
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

type View = 'chat' | 'about-bank';

function App() {
  const [nickname, setNickname] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>('chat');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [tempNickname, setTempNickname] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load data on initialization
  useEffect(() => {
    const data = loadData();
    setNickname(data.nickname);
    setSessions(data.sessions);
    setActiveSessionId(data.activeSessionId);
    
    if (!data.nickname) {
      setIsNicknameModalOpen(true);
      setCurrentView('about-bank');
    }
  }, []);

  // Save data whenever it changes
  useEffect(() => {
    saveData({ nickname, sessions, activeSessionId });
  }, [nickname, sessions, activeSessionId]);

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
      updatedAt: new Date().toISOString()
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setIsSidebarOpen(false);
  }, []);

  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [activeSessionId, sessions]);

  const clearAllSessions = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
    setIsClearModalOpen(false);
  }, []);

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

    let currentSessionId = activeSessionId;
    let newSessions = [...sessions];

    if (!currentSessionId) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: input.trim().substring(0, 30) || 'Nova conversa',
        messages: [],
        updatedAt: new Date().toISOString()
      };
      currentSessionId = newSession.id;
      newSessions = [newSession, ...newSessions];
      setActiveSessionId(currentSessionId);
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
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessageContent,
      attachedImageUrl,
      attachedAudioUrl,
      timestamp: new Date().toISOString()
    };

    // Update sessions with user message
    newSessions = newSessions.map(s => {
      if (s.id === currentSessionId) {
        const updatedMessages = [...s.messages, userMessage];
        return {
          ...s,
          messages: updatedMessages,
          title: s.messages.length === 0 ? userMessageContent.substring(0, 40) : s.title,
          updatedAt: new Date().toISOString()
        };
      }
      return s;
    });
    setSessions(newSessions);

    const currentInput = input.trim();
    setInput('');
    setSelectedFile(null);
    setIsLoading(true);

    try {
      const apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || 
                     (import.meta.env?.VITE_GEMINI_API_KEY);
      
      if (!apiKey) {
        throw new Error("API_KEY_MISSING");
      }

      const genAI = getGenAI();
      const activeSess = newSessions.find(s => s.id === currentSessionId);
      const historyMessages = activeSess?.messages || [];
      
      // Prepare history for Gemini (excluding the current user message)
      const history: any[] = [];
      let lastRole: string | null = null;
      
      // Filter for alternating roles starting with user
      // We exclude the last message because it's the current user message
      const historyToProcess = historyMessages.slice(0, -1).slice(-10);
      for (const m of historyToProcess) {
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

      const response = await genAI.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [
          ...history,
          { role: 'user', parts: currentParts }
        ],
        config: {
          systemInstruction: `Você é a MUH ai, uma assistente virtual inteligente e inovadora. O nome do usuário é ${nickname || 'Utilizador'}. Trate-o de forma amigável, profissional e personalizada. Responda em português brasileiro de forma direta e completa, sem cortar o texto. Use markdown.`,
        }
      });

      let assistantContent = "";
      const assistantMessageId = (Date.now() + 1).toString();

      for await (const chunk of response) {
        if (chunk.candidates?.[0]?.finishReason === 'SAFETY' || chunk.candidates?.[0]?.finishReason === 'OTHER') {
          assistantContent += "\n\n⚠️ *[Resposta interrompida por filtros de segurança ou erro técnico]*";
          break;
        }

        const chunkText = chunk.text || "";
        if (!chunkText) continue;
        assistantContent += chunkText;
        
        // Update assistant message in state
        setSessions(prev => prev.map(s => {
          if (s.id === currentSessionId) {
            const existingMsgIndex = s.messages.findIndex(m => m.id === assistantMessageId);
            let updatedMessages;
            if (existingMsgIndex >= 0) {
              updatedMessages = [...s.messages];
              updatedMessages[existingMsgIndex] = { ...updatedMessages[existingMsgIndex], content: assistantContent };
            } else {
              updatedMessages = [...s.messages, {
                id: assistantMessageId,
                role: 'assistant',
                content: assistantContent,
                timestamp: new Date().toISOString()
              }];
            }
            return { ...s, messages: updatedMessages };
          }
          return s;
        }));
      }
    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      
      let errorMessage = `Desculpe, ocorreu um erro ao processar sua solicitação: ${error?.message || 'Erro desconhecido'}. Por favor, tente novamente.`;
      
      if (error?.message === "API_KEY_MISSING") {
        errorMessage = "⚠️ **Configuração Necessária:** A chave de API não foi encontrada. Por favor, adicione sua GEMINI_API_KEY nas configurações do AI Studio (ícone de engrenagem > Environment Variables).";
      } else if (error?.message?.includes("API key not valid")) {
        errorMessage = "⚠️ **Chave de API Inválida:** A chave de API configurada não é válida. Por favor, gere uma nova chave no Google AI Studio.";
      } else if (error?.message?.includes("Quota exceeded") || error?.message?.includes("429")) {
        errorMessage = "⚠️ **Limite Atingido:** O limite de uso da API foi excedido ou você está enviando muitas mensagens seguidas. Tente novamente em alguns segundos.";
      } else if (error?.message?.includes("Safety") || error?.message?.includes("blocked")) {
        errorMessage = "⚠️ **Conteúdo Bloqueado:** A solicitação foi bloqueada pelos filtros de segurança da IA.";
      }

      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date().toISOString()
      };

      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return { ...s, messages: [...s.messages, errorMsg] };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  }, [input, selectedFile, isLoading, activeSessionId, sessions, nickname]);

  const handleClearData = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  if (isNicknameModalOpen) {
    return (
      <div className="fixed inset-0 bg-brand-dark/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-brand-surface border border-brand-border p-8 rounded-2xl max-w-sm w-full shadow-2xl"
        >
          <div className="w-16 h-16 bg-brand-accent/10 rounded-2xl flex items-center justify-center mb-6 mx-auto border border-brand-accent/20">
            <User className="w-8 h-8 text-brand-accent" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2 text-center">Como devemos chamar você?</h3>
          <p className="text-gray-400 text-sm mb-6 text-center">Personalize sua experiência com a MUH ai.</p>
          <input 
            type="text" 
            value={tempNickname}
            onChange={(e) => setTempNickname(e.target.value)}
            placeholder="Seu apelido"
            className="w-full p-3 bg-brand-dark border border-brand-border rounded-xl text-white mb-4 focus:ring-1 focus:ring-brand-accent focus:outline-none"
            autoFocus
          />
          <button 
            onClick={() => {
              if (tempNickname.trim()) {
                setNickname(tempNickname.trim());
                setIsNicknameModalOpen(false);
              }
            }}
            disabled={!tempNickname.trim()}
            className="w-full py-3 bg-brand-accent text-white font-bold rounded-xl hover:bg-brand-accent/80 transition-all disabled:opacity-50"
          >
            Começar
          </button>
        </motion.div>
      </div>
    );
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
                  <span className="text-[8px] text-brand-accent font-medium uppercase tracking-widest">Inteligência</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 mb-6">
            <button 
              onClick={() => {
                setCurrentView('chat');
                setIsSidebarOpen(false);
              }}
              className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all group ${
                currentView === 'chat' ? 'bg-brand-accent/10 border border-brand-accent/20 text-white' : 'hover:bg-white/5 border border-transparent text-gray-400'
              } ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}
            >
              <MessageSquare className="w-5 h-5 flex-shrink-0" />
              {!isSidebarCollapsed && <span className="text-sm font-medium whitespace-nowrap">Chat Assistant</span>}
            </button>

            <button 
              onClick={() => {
                setCurrentView('about-bank');
                setIsSidebarOpen(false);
              }}
              className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all group ${
                currentView === 'about-bank' ? 'bg-brand-accent/10 border border-brand-accent/20 text-white' : 'hover:bg-white/5 border border-transparent text-gray-400'
              } ${isSidebarCollapsed ? 'lg:justify-center' : ''}`}
            >
              <Globe className="w-5 h-5 flex-shrink-0" />
              {!isSidebarCollapsed && <span className="text-sm font-medium whitespace-nowrap">Sobre a MUH ai</span>}
            </button>
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
                <User className="w-4 h-4 text-brand-accent" />
              </div>
              {!isSidebarCollapsed && (
                <>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs font-medium truncate">{nickname || 'Utilizador'}</p>
                    <p className="text-[10px] text-gray-500">Local Storage</p>
                  </div>
                  <button 
                    onClick={handleClearData}
                    className="p-1.5 hover:bg-white/5 rounded-lg text-gray-600 hover:text-white transition-colors"
                    title="Limpar Dados"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>

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
                <span className="text-[8px] text-brand-accent font-medium uppercase tracking-widest">Inteligência</span>
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

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {currentView === 'about-bank' ? (
            <div className="max-w-4xl mx-auto w-full px-6 py-12">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-12"
              >
                <div className="text-center space-y-4">
                  <h1 className="text-5xl font-bold text-white tracking-tight">Bem-vindo à <span className="text-brand-accent">MUH ai</span></h1>
                  <p className="text-xl text-gray-400 max-w-2xl mx-auto">Sua assistente pessoal inteligente, potencializada por IA de última geração.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[
                    { title: "Inteligência Pura", desc: "Processamento de linguagem natural avançado para entender e resolver suas dúvidas.", icon: "🧠" },
                    { title: "Produtividade", desc: "Crie textos, analise dados e organize sua rotina com ajuda da nossa IA.", icon: "⚡" },
                    { title: "Sempre Disponível", desc: "Suporte 24/7 para ajudar você em qualquer tarefa, a qualquer momento.", icon: "✨" }
                  ].map((feature, i) => (
                    <div key={i} className="p-6 bg-brand-surface border border-brand-border rounded-2xl hover:border-brand-accent/30 transition-all group">
                      <div className="text-3xl mb-4 group-hover:scale-110 transition-transform">{feature.icon}</div>
                      <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                      <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-brand-accent/5 border border-brand-accent/20 rounded-3xl p-8 md:p-12">
                  <div className="grid md:grid-cols-2 gap-12 items-center">
                    <div className="space-y-6">
                      <h2 className="text-3xl font-bold text-white">Nossa Missão</h2>
                      <p className="text-gray-400 leading-relaxed">
                        Na MUH ai, acreditamos que a inteligência artificial deve ser uma ferramenta de empoderamento humano. 
                        Nossa missão é democratizar o acesso à tecnologia de ponta, tornando a vida das pessoas mais simples e produtiva.
                      </p>
                      <ul className="space-y-3">
                        {["Inovação ética", "Foco na experiência", "Privacidade total"].map((item, i) => (
                          <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                            <Sparkles className="w-4 h-4 text-brand-accent" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="relative aspect-video bg-brand-dark rounded-2xl border border-brand-border overflow-hidden shadow-2xl">
                      <img 
                        src="https://picsum.photos/seed/ai-tech/800/600" 
                        alt="MUH ai Technology" 
                        className="object-cover w-full h-full opacity-60"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Bot className="w-16 h-16 text-brand-accent animate-pulse" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center pb-12">
                  <button 
                    onClick={() => setCurrentView('chat')}
                    className="px-8 py-4 bg-brand-accent text-white font-bold rounded-2xl hover:bg-brand-accent/80 transition-all shadow-lg shadow-brand-accent/20"
                  >
                    Falar com a Assistente MUH
                  </button>
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full px-4 py-8">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                  <motion.h2 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-4xl font-semibold text-white mb-12 tracking-tight"
                  >
                    {greeting}, {nickname || 'Utilizador'}!
                  </motion.h2>
                  
                  <div className="w-full max-w-2xl">
                    <ChatInput 
                      input={input}
                      setInput={setInput}
                      handleSend={handleSend}
                      isLoading={isLoading}
                      placeholder="Como a MUH ai pode ajudar hoje?"
                      selectedFile={selectedFile}
                      setSelectedFile={setSelectedFile}
                    />
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
                      {[
                        { icon: "🧠", label: "Ideias Criativas" },
                        { icon: "📝", label: "Resumo de Texto" },
                        { icon: "💻", label: "Ajuda com Código" },
                        { icon: "🎨", label: "Dicas de Design" }
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={() => setInput(`Gostaria de saber sobre ${item.label.toLowerCase()}`)}
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
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          )}
        </main>

        {/* Input Area (Sticky at bottom) */}
        {messages.length > 0 && currentView === 'chat' && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-brand-dark via-brand-dark to-transparent pt-20">
            <div className="max-w-3xl mx-auto">
              <ChatInput 
                input={input}
                setInput={setInput}
                handleSend={handleSend}
                isLoading={isLoading}
                placeholder="Digite sua mensagem..."
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                isSmall
              />
              <p className="text-[10px] text-center text-gray-600 mt-3 tracking-wider uppercase">
                MUH ai pode cometer erros. Verifique informações importantes.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
