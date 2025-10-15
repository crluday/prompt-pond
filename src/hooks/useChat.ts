import { useState, useRef } from 'react';
import { toast } from '@/hooks/use-toast';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString() + Math.random(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Create assistant message placeholder with unique ID
    const assistantMessageId = Date.now().toString() + Math.random() + '_assistant';
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      // Build messages array for API - only include completed messages
      const apiMessages = [...messages, userMessage]
        .filter(msg => msg.role === 'user' || (!msg.isStreaming && msg.content.trim()))
        .map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

      const response = await fetch('http://192.168.11.146:1234/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemma-3-12b',
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: -1,
          stream: true, // Enable streaming
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to get response from API');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              
              if (content) {
                accumulatedContent += content;
                
                // Update the assistant message with accumulated content
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessageId
                      ? { ...msg, content: accumulatedContent, isStreaming: true }
                      : msg
                  )
                );
              }
            } catch (e) {
              // Skip invalid JSON chunks
              console.warn('Failed to parse chunk:', e);
            }
          }
        }
      }
      
      // Mark streaming as complete
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMessageId
            ? { ...msg, isStreaming: false }
            : msg
        )
      );
    } catch (error: any) {
      // Don't show error toast if request was aborted by user
      if (error.name === 'AbortError') {
        console.log('Request aborted by user');
        // Mark the message as complete even though it was aborted
        setMessages(prev => 
          prev.map(msg => 
            msg.id === assistantMessageId
              ? { ...msg, isStreaming: false }
              : msg
          )
        );
      } else {
        console.error('Error sending message:', error);
        toast({
          title: 'Error',
          description: 'Failed to get response from the API. Please check your endpoint configuration.',
          variant: 'destructive',
        });
        
        // Remove the failed assistant message
        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const isStreaming = messages.some(msg => msg.isStreaming);

  return {
    messages,
    isLoading,
    isStreaming,
    sendMessage,
    stopGeneration,
    clearMessages,
  };
};
