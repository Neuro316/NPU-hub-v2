// Deepgram transcription integration

export async function transcribeRecording(recordingUrl: string): Promise<string> {
  const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: recordingUrl }),
  });

  if (!response.ok) {
    throw new Error(`Deepgram error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  return transcript;
}
