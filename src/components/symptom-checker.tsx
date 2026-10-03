"use client";

import {
  useState,
  useRef,
  FormEvent,
  useEffect,
  useCallback,
} from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  Bot,
  Send,
  User,
  Loader2,
  PlusCircle,
  Zap,
  MessageCircleQuestion,
  AlertTriangle,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import DiagnosisResults from "./diagnosis-results";

import type {
  AiDiagnosisInput,
  AiDiagnosisOutput,
} from "@/lib/types";

import { getDiagnosisAction } from "@/app/actions";
import { cn } from "@/lib/utils";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "./ui/alert";

/* =========================================================
   TYPES
   ========================================================= */

interface Message {
  id: string;
  role: "user" | "assistant";
  content: React.ReactNode;
  textContent: string;
}

type ChatMode = "quick" | "detailed";

type FollowUpResponse = {
  followUpQuestion: string;
};

type DiagnosisResponse = {
  diagnosis: AiDiagnosisOutput["diagnosis"];
};

type DiagnosisActionData =
  | FollowUpResponse
  | DiagnosisResponse;

/* =========================================================
   TYPE GUARDS
   ========================================================= */

/**
 * Safely determines whether an AI response contains
 * a follow-up question.
 */
function isFollowUpResponse(
  data: unknown
): data is FollowUpResponse {
  if (!data || typeof data !== "object") {
    return false;
  }

  const value = data as Record<string, unknown>;

  return (
    typeof value.followUpQuestion === "string" &&
    value.followUpQuestion.trim().length > 0
  );
}

/**
 * Safely determines whether an AI response contains
 * a diagnosis object.
 */
function isDiagnosisResponse(
  data: unknown
): data is DiagnosisResponse {
  if (!data || typeof data !== "object") {
    return false;
  }

  const value = data as Record<string, unknown>;

  return (
    "diagnosis" in value &&
    value.diagnosis !== null &&
    typeof value.diagnosis === "object"
  );
}

/* =========================================================
   COMPONENT
   ========================================================= */

export default function SymptomChecker() {
  const [chatMode, setChatMode] = useState<ChatMode | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const { toast } = useToast();

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  /* =======================================================
     AUTO SCROLL
     ======================================================= */

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      "div[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null;

    if (!viewport) {
      return;
    }

    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }, [messages, isLoading]);

  /* =======================================================
     START CHAT
     ======================================================= */

  const startChat = useCallback((mode: ChatMode) => {
    setError(null);
    setInput("");

    const initialMessage =
      mode === "quick"
        ? "I've selected Quick Solutions. I'm ready to listen whenever you are."
        : "I've selected Detailed Symptoms. Please describe what you're experiencing in detail.";

    setMessages([
      {
        id: `start-${Date.now()}`,
        role: "assistant",
        content: initialMessage,
        textContent: initialMessage,
      },
    ]);

    setChatMode(mode);
  }, []);

  /* =======================================================
     NEW CHAT
     ======================================================= */

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setIsLoading(false);
    setChatMode(null);
    setError(null);
  }, []);

  /* =======================================================
     SUBMIT
     ======================================================= */

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedInput = input.trim();

    /*
     * Prevent:
     * - Empty requests
     * - Double clicks
     * - Requests without a selected mode
     */
    if (
      !trimmedInput ||
      isLoading ||
      !chatMode
    ) {
      return;
    }

    /* ---------------------------------------------
       USER MESSAGE
    --------------------------------------------- */

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedInput,
      textContent: trimmedInput,
    };

    const newMessages = [
      ...messages,
      userMessage,
    ];

    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      /* ---------------------------------------------
         BUILD API HISTORY
      --------------------------------------------- */

      const historyForApi: AiDiagnosisInput["history"] =
        newMessages.map((message) => ({
          role: message.role,
          content: message.textContent,
        }));

      /* ---------------------------------------------
         CALL SERVER ACTION
      --------------------------------------------- */

      const result = await getDiagnosisAction({
        mode: chatMode,
        history: historyForApi,
      });

      /* ---------------------------------------------
         HANDLE SERVER ERROR
      --------------------------------------------- */

      if (!result || result.success !== true) {
        const errorMessage =
          result?.error ||
          "The AI service could not process your request.";

        setError(errorMessage);

        toast({
          variant: "destructive",
          title: "AI Service Error",
          description: errorMessage,
        });

        return;
      }

      /* ---------------------------------------------
         VALIDATE AI RESPONSE
      --------------------------------------------- */

      const aiResponse = result.data as
        | DiagnosisActionData
        | undefined;

      if (!aiResponse) {
        const fallbackMessage =
          "I couldn't generate a response right now. Please try again.";

        setError(fallbackMessage);

        toast({
          variant: "destructive",
          title: "No AI Response",
          description: fallbackMessage,
        });

        return;
      }

      /* ---------------------------------------------
         BUILD ASSISTANT MESSAGE
      --------------------------------------------- */

      let assistantMessage: Message;

      /* ---------------------------------------------
         FOLLOW-UP QUESTION
      --------------------------------------------- */

      if (isFollowUpResponse(aiResponse)) {
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: aiResponse.followUpQuestion,
          textContent: aiResponse.followUpQuestion,
        };
      }

      /* ---------------------------------------------
         DIAGNOSIS
      --------------------------------------------- */

      else if (isDiagnosisResponse(aiResponse)) {
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",

          content: (
            <DiagnosisResults
              diagnosis={aiResponse.diagnosis}
            />
          ),

          textContent:
            "Here is your preliminary health analysis. This is not a medical diagnosis. Please consult a qualified healthcare professional for diagnosis and treatment.",
        };
      }

      /* ---------------------------------------------
         INVALID AI STRUCTURE
      --------------------------------------------- */

      else {
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",

          content:
            "I received an unexpected response. Please try again.",

          textContent:
            "I received an unexpected response. Please try again.",
        };
      }

      /* ---------------------------------------------
         ADD AI MESSAGE
      --------------------------------------------- */

      setMessages((previousMessages) => [
        ...previousMessages,
        assistantMessage,
      ]);
    } catch (err) {
      console.error(
        "Symptom checker error:",
        err
      );

      const errorMessage =
        err instanceof Error
          ? err.message
          : "Something went wrong while contacting the AI service.";

      setError(errorMessage);

      toast({
        variant: "destructive",
        title: "Something went wrong",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     RENDER MAIN CONTENT
     ======================================================= */

  const renderContent = () => {
    /* ---------------------------------------------
       INITIAL ERROR STATE
    --------------------------------------------- */

    if (error && messages.length <= 1) {
      return (
        <div className="flex items-center justify-center h-full p-4">
          <Alert
            variant="destructive"
            className="max-w-md"
          >
            <AlertTriangle className="h-4 w-4" />

            <AlertTitle>
              AI Service Unavailable
            </AlertTitle>

            <AlertDescription>
              {error}

              <div className="mt-2 text-xs opacity-80">
                Please try again. If the problem
                continues, check your server-side
                Groq API configuration.
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    /* ---------------------------------------------
       MODE SELECTION
    --------------------------------------------- */

    if (!chatMode) {
      return (
        <div className="text-center text-muted-foreground pt-12 px-4 animated-fade-in">
          <Bot className="mx-auto h-12 w-12 mb-4" />

          <p className="font-medium text-lg text-foreground">
            How would you like to proceed?
          </p>

          <p className="text-sm mb-8">
            Choose a mode that best fits your needs.
          </p>

          <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto">

            {/* QUICK MODE */}

            <Card
              onClick={() => startChat("quick")}
              className="text-left hover:border-primary cursor-pointer transition-all hover:shadow-lg"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" />

                  Quick Solutions
                </CardTitle>

                <CardDescription>
                  Get a fast, high-level analysis
                  with minimal questions. Ideal
                  when you want a quick insight.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* DETAILED MODE */}

            <Card
              onClick={() =>
                startChat("detailed")
              }
              className="text-left hover:border-primary cursor-pointer transition-all hover:shadow-lg"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircleQuestion className="w-5 h-5 text-primary" />

                  Detailed Symptoms
                </CardTitle>

                <CardDescription>
                  Engage in a more thorough
                  conversation to explore your
                  symptoms in depth.
                </CardDescription>
              </CardHeader>
            </Card>

          </div>
        </div>
      );
    }

    /* ---------------------------------------------
       CHAT
    --------------------------------------------- */

    return (
      <div className="space-y-6">

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex items-start gap-3",
              message.role === "user"
                ? "justify-end"
                : "justify-start"
            )}
          >

            {/* ASSISTANT AVATAR */}

            {message.role === "assistant" && (
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary/80">
                  <Bot className="h-5 w-5 text-primary-foreground" />
                </AvatarFallback>
              </Avatar>
            )}

            {/* MESSAGE */}

            <div
              className={cn(
                "max-w-[85%] md:max-w-md p-3 rounded-2xl",
                message.role === "user"
                  ? "bg-primary/90 text-primary-foreground rounded-br-none"
                  : "bg-muted rounded-bl-none"
              )}
            >
              {typeof message.content === "string" ? (
                <p className="text-sm whitespace-pre-wrap">
                  {message.content}
                </p>
              ) : (
                message.content
              )}
            </div>

            {/* USER AVATAR */}

            {message.role === "user" && (
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback>
                  <User className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
            )}

          </div>
        ))}

        {/* LOADING */}

        {isLoading && (
          <div className="flex items-start gap-3 justify-start">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/80">
                <Bot className="h-5 w-5 text-primary-foreground" />
              </AvatarFallback>
            </Avatar>

            <div className="max-w-md p-3 rounded-2xl bg-muted rounded-bl-none flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />

              <p className="text-sm text-muted-foreground">
                Analyzing...
              </p>
            </div>
          </div>
        )}

        {/* REQUEST ERROR */}

        {error && messages.length > 1 && !isLoading && (
          <Alert
            variant="destructive"
            className="max-w-xl mx-auto"
          >
            <AlertTriangle className="h-4 w-4" />

            <AlertTitle>
              Unable to complete request
            </AlertTitle>

            <AlertDescription>
              {error}
            </AlertDescription>
          </Alert>
        )}

      </div>
    );
  };

  /* =======================================================
     COMPONENT UI
     ======================================================= */

  return (
    <div className="bg-card border rounded-xl shadow-lg max-w-4xl mx-auto flex flex-col h-[70vh]">

      {/* HEADER */}

      <div className="p-4 border-b flex justify-between items-center">

        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />

          AI Companion

          {chatMode && (
            <span className="text-sm text-muted-foreground">
              (
              {chatMode === "quick"
                ? "Quick"
                : "Detailed"}
              )
            </span>
          )}
        </h2>

        <Button
          variant="outline"
          size="sm"
          onClick={handleNewChat}
          disabled={isLoading}
        >
          <PlusCircle className="mr-2 h-4 w-4" />

          New Chat
        </Button>

      </div>

      {/* CHAT AREA */}

      <ScrollArea
        className="flex-1 p-4"
        ref={scrollAreaRef}
      >
        {renderContent()}
      </ScrollArea>

      {/* INPUT */}

      {chatMode && (
        <div className="border-t p-4">

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2"
          >

            <Input
              value={input}
              onChange={(event) =>
                setInput(event.target.value)
              }
              placeholder="Describe your symptoms or answer the question..."
              className="flex-1"
              disabled={isLoading}
              autoFocus
              maxLength={2000}
            />

            <Button
              type="submit"
              disabled={
                isLoading ||
                !input.trim()
              }
              size="icon"
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>

          </form>

          {/* MEDICAL DISCLAIMER */}

          <p className="text-[11px] text-muted-foreground text-center mt-2">
            This AI companion provides general health
            information only and is not a substitute for
            professional medical advice, diagnosis, or
            treatment. For severe or emergency symptoms,
            seek immediate medical care.
          </p>

        </div>
      )}

    </div>
  );
}