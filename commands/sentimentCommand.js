const axios = require('axios');
const logger = require('../utils/logger');
const { generateTextWithDeepSeek, generateTextWithQwen } = require('../utils/textGen');

module.exports = {
    command: 'sentimento',
    description: 'Analisa o sentimento de uma mensagem.',
    
    execute: async (text, message) => {
        const trimmedText = text.trim();

        try {
            const response = await axios.post(
                'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
                { inputs: trimmedText },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!response.data || response.data.length === 0 || !response.data[0].label) {
                logger.error('Resposta da API não contém dados esperados:', response.data);
                await message.reply('Desculpe, não consegui analisar o sentimento. A resposta da API não está correta.');
                return;
            }

            const sentiment = response.data[0].label; 
            logger.info(`Sentimento detectado: ${sentiment}`);

            let generatedText;
            if (sentiment === 'POSITIVE') {
                generatedText = await generateTextWithDeepSeek("Sugira uma resposta envolvente para um cliente satisfeito.");
            } else if (sentiment === 'NEGATIVE') {
                generatedText = await generateTextWithQwen("Dê uma resposta acolhedora para uma reclamação de cliente.");
            } else {
                generatedText = await generateTextWithDeepSeek("Como posso ajudar um cliente?");
            }

            await message.reply(generatedText);
        } catch (error) {
            logger.error('Erro ao analisar sentimento:', error.message);
            await message.reply('Desculpe, não consegui analisar o sentimento.');
        }
    },
};