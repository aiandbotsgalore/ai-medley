import { GoogleGenAI } from '@google/genai';
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'fake' });
const chat = genAI.chats.create({ model: 'gemini-2.5-flash' });
console.log('Chat object prototype:', Object.getPrototypeOf(chat).constructor.name);
