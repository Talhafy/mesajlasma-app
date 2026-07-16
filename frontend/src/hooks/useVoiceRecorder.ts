import { useState, useEffect, useRef } from 'react';

export function useVoiceRecorder() {
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  const isRecordingCancelledRef = useRef(false);
  const recordingDurationRef = useRef(0);
  const recordingIntervalRef = useRef<any>(null);
  const onVoiceRecordingRef = useRef<((isRecording: boolean) => void) | null>(null);

  useEffect(() => {
    if (isRecordingAudio) {
      setRecordingDuration(0);
      recordingDurationRef.current = 0;
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
            return prev;
          }
          const newVal = prev + 1;
          recordingDurationRef.current = newVal;

          if (newVal >= 3599) {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
            setIsRecordingAudio(false);
            if (onVoiceRecordingRef.current) {
              onVoiceRecordingRef.current(false);
            }
          }

          return newVal;
        });
      }, 1000);
    } else {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }

    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, [isRecordingAudio]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startRecording = async (
    onVoiceRecording: (isRecording: boolean) => void,
    uploadCallback: (audioBlob: Blob, durationSeconds: number) => Promise<void>
  ) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Tarayıcınız ses kaydını desteklemiyor.');
      return;
    }

    onVoiceRecordingRef.current = onVoiceRecording;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedAudioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedAudioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());

        if (isRecordingCancelledRef.current) {
          recordedAudioChunksRef.current = [];
          isRecordingCancelledRef.current = false;
          return;
        }

        const audioBlob = new Blob(recordedAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recordedAudioChunksRef.current = [];

        const finalDuration = recordingDurationRef.current;
        void uploadCallback(audioBlob, finalDuration);
      };

      setRecordingDuration(0);
      recordingDurationRef.current = 0;
      isRecordingCancelledRef.current = false;
      setIsRecordingPaused(false);

      recorder.start();
      setIsRecordingAudio(true);
      onVoiceRecording(true);
    } catch {
      alert('Mikrofon izni alınamadı.');
    }
  };

  const pauseResumeRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsRecordingPaused(true);
    } else if (mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsRecordingPaused(false);
    }
  };

  const cancelRecording = (onVoiceRecording: (isRecording: boolean) => void) => {
    isRecordingCancelledRef.current = true;
    if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingAudio(false);
    setIsRecordingPaused(false);
    onVoiceRecording(false);
  };

  const sendRecording = (onVoiceRecording: (isRecording: boolean) => void) => {
    isRecordingCancelledRef.current = false;
    if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingAudio(false);
    setIsRecordingPaused(false);
    onVoiceRecording(false);
  };

  return {
    isRecordingAudio,
    isRecordingPaused,
    recordingDuration,
    startRecording,
    pauseResumeRecording,
    cancelRecording,
    sendRecording
  };
}
