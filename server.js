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
        const { name, age, interest, question } = req.body;
        
        if (!question || !name) {
            return res.status(400).json({ error: 'Name and question are required' });
        }

        // Enhanced prompt for personalized predictions
        const prompt = `
        Act as a mystical fortune teller. The querent is ${name}, ${age} years old, 
        seeking guidance about ${interest}. Their specific question is: "${question}".

        Provide a detailed 3-paragraph prediction that includes:
        1. Current cosmic influences affecting their situation
        2. What the near future (3-6 months) holds
        3. Long-term possibilities and advice
        
        Use mystical language with references to planetary alignments, energy flows, 
        and cosmic signs. Maintain a positive yet mysterious tone. Avoid generic 
        statements - be specific to their question and age group.
        `;

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
                        content: "You are an accurate, insightful fortune teller with mystical abilities."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 500
            })
        });

        if (!groqResponse.ok) {
            throw new Error(`API request failed with status ${groqResponse.status}`);
        }

        const data = await groqResponse.json();
        const prediction = data.choices[0]?.message?.content || 
                         "The cosmic energies are unclear at this moment. Try again later.";

        res.json({ prediction });

    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({ 
            error: "The cosmic connection was disrupted",
            details: error.message 
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.send('Future Visionary API is running');
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
