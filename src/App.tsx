import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode, memo, lazy, Suspense } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Sparkles, Loader2, Trash2, Plus, Paperclip, ChevronDown, Globe, Mic, Square, Volume2 } from 'lucide-react';

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

// Memoized Message Item for performance
const MessageItem = memo(({ message }: { message: Message }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className={`flex gap-6 ${message.role === 'assistant' ? '' : 'flex-row-reverse'}`}
  >
    <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-1 ${
      message.role === 'assistant' ? 'bg-brand-accent/10 text-brand-accent border border-brand-accent/20' : 'bg-white/10 text-white border border-white/10'
    }`}>
      {message.role === 'assistant' ? <Bot className="w-5 h-5" /> : <User className="w-4 h-4" />}
    </div>
    <div className={`flex flex-col max-w-[85%] ${message.role === 'assistant' ? '' : 'items-end'}`}>
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
                : `text-white bg-brand-accent hover:bg-brand-accent/80 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(99,102,241,0.3)]`
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [greeting, setGreeting] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setGreeting('Bom dia');
    else if (hour >= 12 && hour < 18) setGreeting('Boa tarde');
    else if (hour >= 18 && hour < 24) setGreeting('Boa noite');
    else setGreeting('Boa madrugada');
  }, []);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    const timeout = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeout);
  }, [messages]);

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

  const handleSend = async () => {
    if ((!input.trim() && !selectedFile) || isLoading) return;

    // Check if API key is configured
    if (!import.meta.env.VITE_GEMINI_API_KEY) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "⚠️ **Configuração Necessária:** A chave de API (`VITE_GEMINI_API_KEY`) não foi encontrada. No Cloudflare Pages, adicione-a em 'Environment variables' nas configurações de build.",
        timestamp: new Date(),
      }]);
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

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input.trim();
    const currentFile = selectedFile;
    setInput('');
    setSelectedFile(null);
    
    setIsLoading(true);

    try {
      const assistantMessageId = (Date.now() + 1).toString();
      
      let assistantContent = "";

      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }]);

      // Prepare contents for multimodal call
      const history = messages.map(m => ({
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
          systemInstruction: "Você é a MUH ai, uma IA rápida e eficiente. Responda em português brasileiro de forma direta e amigável. Use markdown.",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        }
      });

      for await (const chunk of response) {
        const chunkText = chunk.text;
        assistantContent += chunkText;
        
        setMessages(prev => prev.map(m => 
          m.id === assistantMessageId ? { ...m, content: assistantContent } : m
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

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen bg-brand-dark text-gray-200">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-brand-dark/80 backdrop-blur-md border-b border-brand-border sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={clearChat}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500 hover:text-white"
          >
            <Plus className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 px-2 py-1 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
            <span className="text-sm font-medium text-gray-200 tracking-tight">MUH ai</span>
            <ChevronDown className="w-4 h-4 text-gray-600" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-accent/10 rounded-full flex items-center justify-center border border-brand-accent/20 overflow-hidden">
            <Bot className="w-4 h-4 text-brand-accent" />
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 py-8">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <motion.h2 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl font-semibold text-white mb-12 tracking-tight"
              >
                {greeting}, como posso ajudar?
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
            <div className="space-y-12 pb-60">
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
        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-brand-dark via-brand-dark to-transparent pt-12 pb-6 px-4">
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
  );
}
