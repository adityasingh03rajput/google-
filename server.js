require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API endpoint for predictions
app.post('/api/predict', async (req, res) => {
    try {
        const { question } = req.body;
        
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        // Call Groq API for prediction
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "mixtral-8x7b-32768",
                messages: [
                    {
                        role: "system",
                        content: "You are a mystical fortune teller who provides insightful, positive predictions about the future. Respond in a mysterious yet encouraging tone, with 2-3 sentences. Include some cosmic elements like stars, planets, or energy in your response."
                    },
                    {
                        role: "user",
                        content: question
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            })
        });

        if (!groqResponse.ok) {
            throw new Error(`Groq API error: ${groqResponse.statusText}`);
        }

        const data = await groqResponse.json();
        const prediction = data.choices[0]?.message?.content || "The cosmic energies are unclear at this moment.";

        res.json({ prediction });

    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
