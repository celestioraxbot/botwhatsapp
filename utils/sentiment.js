const axios = require('axios');
const logger = require('./logger');
const { generateTextWithDeepSeek, generateTextWithQwen } = require('./textGen');

async function analyzeAndRespond(message) {
    const text = message.body.trim();

    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
            { inputs: text },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        // Verifica se a resposta contém o dado esperado
        if (response.data && response.data.length > 0 && response.data[0].label) {
            const sentiment = response.data[0].label; // 'POSITIVE', 'NEGATIVE', ou 'NEUTRAL'
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
        } else {
            logger.error('Resposta da API não contém os dados esperados.');
            await message.reply('Desculpe, não consegui analisar o sentimento. A resposta da API não está correta.');
        }
    } catch (error) {
        logger.error('Erro ao analisar sentimento:', error.message);
        await message.reply('Desculpe, ocorreu um erro ao analisar o sentimento.');
    }
}

module.exports = { analyzeAndRespond };