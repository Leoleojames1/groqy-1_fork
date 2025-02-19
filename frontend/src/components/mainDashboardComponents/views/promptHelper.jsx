// /src/components/mainDashboardComponents/views/promptHelper.jsx

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Loader2, Send, Volume2, RefreshCcw, StopCircle } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function VoiceEnabledLLMInteractions() {
    const [input, setInput] = useState("");
    const [isListening, setIsListening] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);
    const [interactions, setInteractions] = useState([]);
    const [voices, setVoices] = useState([]);
    const [selectedVoice, setSelectedVoice] = useState('');
    const [conversationContext, setConversationContext] = useState([]);

    const recognitionRef = useRef(null);
    const audioRef = useRef(new Audio());
    const abortControllerRef = useRef(null);

    useEffect(() => {
        setupSpeechRecognition();
        fetchVoices();

        return () => {
            if (recognitionRef.current)
            {
                recognitionRef.current.stop();
            }
            if (audioRef.current)
            {
                audioRef.current.pause();
                audioRef.current.src = "";
            }
            if (abortControllerRef.current)
            {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    // Fetch available voices from the API
    const fetchVoices = async () => {
        try
        {
            const response = await fetch('/api/openai/v1/voices');
            if (response.ok)
            {
                const data = await response.json();
                setVoices(data.voices);
                if (data.voices.length > 0)
                {
                    setSelectedVoice(data.voices[0].voice_id);
                }
            } else
            {
                throw new Error('Failed to fetch voices');
            }
        } catch (err)
        {
            console.error('Error fetching voices:', err);
            toast.error('An error occurred while fetching voices.');
        }
    };

    // Setup speech recognition for voice input
    const setupSpeechRecognition = () => {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
        {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;
            recognitionRef.current.onresult = handleSpeechResult;
            recognitionRef.current.onerror = handleSpeechError;
            recognitionRef.current.onend = () => setIsListening(false);
        } else
        {
            toast.error('Speech recognition not supported in this browser.');
        }
    };

    // Handle speech recognition result
    const handleSpeechResult = (event) => {
        const finalTranscript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join('');

        setInput(finalTranscript);
        handleUserInput(finalTranscript, 'speech');
    };

    // Handle speech recognition errors
    const handleSpeechError = (event) => {
        console.error('Speech recognition error', event.error);
        toast.error(`Speech recognition error: ${event.error}`);
        setIsListening(false);
    };

    // Add interaction to the log and conversation context
    const addInteraction = (type, content, role = 'user') => {
        const newInteraction = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            type,
            content,
            role
        };
        setInteractions(prev => [...prev, newInteraction]);
        setConversationContext(prev => [...prev, { role, content }]);
    };

    // Start listening for voice input
    const startListening = () => {
        if (recognitionRef.current && !isListening)
        {
            recognitionRef.current.start();
            setIsListening(true);
            toast.success('Listening...');
        }
    };

    // Stop listening
    const stopListening = () => {
        if (recognitionRef.current && isListening)
        {
            recognitionRef.current.stop();
            setIsListening(false);
            toast.success('Stopped listening.');
        }
    };

    // Handle input change in the text area
    const handleInputChange = (e) => {
        setInput(e.target.value);
    };

    // Handle Enter key press in the text area
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey)
        {
            e.preventDefault();
            handleUserInput(input, 'text');
        }
    };

    // Handle user's input (text or speech)
    const handleUserInput = useCallback(async (content, type) => {
        if (!content.trim()) return;

        addInteraction(type, content);
        setInput("");
        setIsLoading(true);
        setPlaybackError(false);

        try
        {
            console.log('Sending request to LLM API...');
            const response = await fetch('/api/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        ...conversationContext,
                        { role: "user", content }
                    ],
                    model: "llama-3.1-8b-instant"
                })
            });

            if (!response.ok)
            {
                const errorText = await response.text();
                throw new Error(`Failed to get response from API. Status: ${response.status}, Error: ${errorText}`);
            }

            const data = await response.json();
            console.log('Received response from LLM API:', data);

            if (!data.choices || data.choices.length === 0 || !data.choices[0].message)
            {
                throw new Error('Invalid response format from LLM API');
            }

            const assistantResponse = data.choices[0].message.content;
            addInteraction('llm', assistantResponse, 'assistant');

            console.log('Attempting to play voice response...');
            await playVoiceResponse(assistantResponse);
            console.log('Voice response played successfully');
        } catch (error)
        {
            console.error('Error in handleUserInput:', error);
            toast.error(`Failed to process message: ${error.message}`);
            setPlaybackError(true);
        } finally
        {
            setIsLoading(false);
        }
    }, [conversationContext, selectedVoice]);

    // Play the assistant's response using TTS
    const playVoiceResponse = useCallback(async (text) => {
        if (!text || !selectedVoice)
        {
            console.error('Text or voice_id not provided for text-to-speech');
            toast.error('Unable to play voice response. Missing text or voice model.');
            return;
        }

        setIsPlayingAudio(true);
        try
        {
            const response = await fetch('/api/openai/v1/text-to-speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text, voice_id: selectedVoice }), // Using voice_id
            });

            if (!response.ok)
            {
                const errorText = await response.text();
                throw new Error(`Failed to synthesize speech. Status: ${response.status}, Error: ${errorText}`);
            }

            const blob = await response.blob();

            if (blob.size === 0)
            {
                throw new Error('Received empty audio blob');
            }

            const audioUrl = URL.createObjectURL(blob);
            audioRef.current.src = audioUrl;

            const playPromise = audioRef.current.play();

            if (playPromise !== undefined)
            {
                playPromise.then(() => {
                    console.log('Audio playback started');
                }).catch((error) => {
                    console.error('Audio playback failed:', error);
                    toast.error('Autoplay was blocked. Please click the play button to listen.');
                });
            }
        } catch (error)
        {
            console.error('Error in playVoiceResponse:', error);
            toast.error(`Failed to play voice response: ${error.message}`);
        } finally
        {
            setIsPlayingAudio(false);
        }
    }, [selectedVoice]);

    // Retry playing the assistant's response (if applicable)
    const retryPlayback = async (interaction) => {
        try
        {
            await playVoiceResponse(interaction.content);
            toast.success('Playback successful on retry.');
            setPlaybackError(false);
        } catch (error)
        {
            toast.error('Retry failed: ' + error.message);
        }
    };

    // Stop current audio playback
    const stopPlayback = () => {
        if (audioRef.current)
        {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setIsPlayingAudio(false);
            toast('Playback stopped.');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-r from-pink-100 to-purple-200 flex items-center justify-center p-4">
            <Toaster />
            <Card className="w-full max-w-4xl mx-auto shadow-xl">
                <CardContent className="p-6">
                    <div className="mb-4">
                        <textarea
                            value={input}
                            onChange={handleInputChange}
                            onKeyPress={handleKeyPress}
                            placeholder="Type or speak your message..."
                            className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none overflow-hidden"
                            style={{ minHeight: '40px', maxHeight: '120px' }}
                        />
                        <div className="mt-2 flex justify-between items-center">
                            <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select a voice" />
                                </SelectTrigger>
                                <SelectContent>
                                    {voices.map((voice) => (
                                        <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                            {voice.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <div className="flex space-x-2">
                                <Button
                                    onClick={() => handleUserInput(input, 'text')}
                                    disabled={isLoading || !input.trim()}
                                    className="bg-pink-500 hover:bg-pink-600 flex items-center space-x-1"
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    <span>Send</span>
                                </Button>
                                <Button
                                    onClick={isListening ? stopListening : startListening}
                                    className={`bg-purple-500 hover:bg-purple-600 flex items-center space-x-1 ${isListening ? 'animate-pulse' : ''}`}
                                >
                                    <Mic className={`h-4 w-4 ${isListening ? 'text-red-500' : ''}`} />
                                    <span>{isListening ? 'Stop' : 'Start'} Listening</span>
                                </Button>
                                <Button
                                    onClick={stopPlayback}
                                    disabled={!isPlayingAudio}
                                    className="bg-red-500 hover:bg-red-600 flex items-center space-x-1"
                                >
                                    <StopCircle className="h-4 w-4" />
                                    <span>Stop Playback</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                    <Table>
                        <TableCaption>A list of your recent interactions</TableCaption>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Timestamp</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Content</TableHead>
                                <TableHead>Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {interactions.map((interaction) => (
                                <TableRow key={interaction.id}>
                                    <TableCell>{new Date(interaction.timestamp).toLocaleString()}</TableCell>
                                    <TableCell>{interaction.type}</TableCell>
                                    <TableCell>{interaction.role}</TableCell>
                                    <TableCell>{interaction.content}</TableCell>
                                    <TableCell>
                                        {interaction.role === 'assistant' && (
                                            <div className="flex space-x-2">
                                                <Button
                                                    onClick={() => playVoiceResponse(interaction.content)}
                                                    className="bg-blue-500 hover:bg-blue-600 flex items-center space-x-1"
                                                >
                                                    <Volume2 className="h-4 w-4" />
                                                    <span>Play</span>
                                                </Button>
                                                {interaction.type === 'llm' && (
                                                    <Button
                                                        onClick={() => retryPlayback(interaction)}
                                                        className="bg-green-500 hover:bg-green-600 flex items-center space-x-1"
                                                    >
                                                        <RefreshCcw className="h-4 w-4" />
                                                        <span>Retry</span>
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
