import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode, memo, lazy, Suspense } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Sparkles, Loader2, Trash2, Plus, Paperclip, ChevronDown, Globe, LogIn, LogOut } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';

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
      let errorMessage = "Ocorreu um erro inesperado.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Erro no banco de dados: ${parsedError.error}`;
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-brand-dark text-white p-6 text-center">
          <h2 className="text-2xl font-bold text-red-500 mb-4">Ops! Algo deu errado.</h2>
          <p className="text-gray-400 mb-6 max-w-md">{errorMessage}</p>
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
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
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
  isSmall = false
}: { 
  input: string, 
  setInput: (val: string) => void, 
  handleSend: () => void, 
  isLoading: boolean, 
  placeholder: string,
  isSmall?: boolean
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  return (
    <div className="neon-border-container group">
      <div className={`relative bg-brand-surface rounded-[15px] p-2 shadow-2xl ${isSmall ? '' : 'border border-white/5'}`}>
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
          className={`w-full p-4 bg-transparent border-none focus:ring-0 text-white placeholder-gray-600 resize-none ${isSmall ? 'min-h-[56px] max-h-40 text-base' : 'min-h-[100px] text-lg'}`}
          rows={1}
        />
        <div className={`flex items-center justify-between px-2 ${isSmall ? 'pb-1' : 'pb-2'}`}>
          <div className="flex items-center gap-1">
            <button className="p-2 text-gray-600 hover:text-brand-accent hover:bg-brand-accent/10 rounded-lg transition-all">
              <Paperclip className={isSmall ? "w-4 h-4" : "w-5 h-5"} />
            </button>
          </div>
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className={`p-2 rounded-xl transition-all ${
              !input.trim() || isLoading
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
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [greeting, setGreeting] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        // Sync user data to Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              createdAt: new Date().toISOString(),
              lastLogin: new Date().toISOString()
            });
          } else {
            await updateDoc(userRef, {
              lastLogin: new Date().toISOString()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMessages([]);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

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

  // Input auto-resize logic moved to ChatInput component

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input.trim();
    setInput('');
    
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

      const response = await genAI.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [...messages, userMessage].map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: "Você é a MUH ai, uma inteligência artificial avançada, prestativa e amigável, com uma personalidade similar ao Claude. Suas respostas devem ser claras, precisas e em português brasileiro. Use markdown para formatar suas respostas quando apropriado.",
        }
      });

      for await (const chunk of response) {
        const chunkText = chunk.text;
        assistantContent += chunkText;
        
        setMessages(prev => prev.map(m => 
          m.id === assistantMessageId ? { ...m, content: assistantContent } : m
        ));
      }

    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.",
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-brand-dark">
        <Loader2 className="w-8 h-8 text-brand-accent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-brand-dark text-white p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md"
        >
          <div className="neon-border-container">
            <div className="bg-brand-surface rounded-[15px] p-8 text-center shadow-2xl border border-white/5">
              <div className="w-16 h-16 bg-brand-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-brand-accent/20">
                <Sparkles className="w-8 h-8 text-brand-accent" />
              </div>
              <h1 className="text-3xl font-bold mb-2 tracking-tight">Bem-vindo à MUH ai</h1>
              <p className="text-gray-400 mb-8 text-sm">Faça login para começar a usar a inteligência artificial mais avançada.</p>
              
              <button 
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/listview/google.svg" alt="Google" className="w-5 h-5" />
                Entrar com Google
              </button>
              
              <p className="mt-6 text-[10px] text-gray-600 uppercase tracking-widest font-bold">
                Seguro • Rápido • Inteligente
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

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
          {user && (
            <div className="flex items-center gap-3">
              <button 
                onClick={handleLogout}
                className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 bg-brand-accent/10 rounded-full flex items-center justify-center border border-brand-accent/20 overflow-hidden">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ""} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-4 h-4 text-brand-accent" />
                )}
              </div>
            </div>
          )}
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
            <div className="space-y-12 pb-32">
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
