import { useState, useEffect, useRef } from 'react';

/**
 * Web tarayıcısının `MediaRecorder` ve `getUserMedia` API'lerini kullanarak
 * mikrofon üzerinden ses kaydı alma, duraklatma, devam ettirme, kaydı iptal etme ve 
 * kaydedilen ses verisini (Blob) üst bileşene iletme işlemlerini yöneten özel React Hook.
 */
export function useVoiceRecorder() {
  /** Ses kaydının aktif olup olmadığı durumu */
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  /** Ses kaydının duraklatılmış (paused) olup olmadığı durumu */
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  /** Kaydın geçen süresi (saniye cinsinden) */
  const [recordingDuration, setRecordingDuration] = useState(0);

  /** MediaRecorder nesnesi referansı */
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  /** Kayıt sırasında biriken ses veri parçaları (audio/webm veya audio/mp4) */
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  /** Kaydın iptal edilip edilmediğini takip eden bayrak (flag) */
  const isRecordingCancelledRef = useRef(false);
  /** Kayıt süresinin güncel değerini tutan referans */
  const recordingDurationRef = useRef(0);
  /** Saniye sayacı zamanlayıcı (interval) referansı */
  const recordingIntervalRef = useRef<any>(null);
  /** Ses kayıt durumundaki değişimi üst bileşene bildiren callback referansı */
  const onVoiceRecordingRef = useRef<((isRecording: boolean) => void) | null>(null);

  // Ses kaydı başladığında saniyelik zamanlayıcıyı çalıştırır, durduğunda temizler
  useEffect(() => {
    if (isRecordingAudio) {
      setRecordingDuration(0);
      recordingDurationRef.current = 0;
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          // Kayıt duraklatıldıysa sayacı ilerletme
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
            return prev;
          }
          const newVal = prev + 1;
          recordingDurationRef.current = newVal;

          // Maksimum kayıt süresi (59 dakika 59 saniye = 3599s) dolduğunda kaydı otomatik durdur
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

  // Hook sonlandığında (unmount) mikrofon erişim iznini ve medya izlerini (track) kapatır
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  /**
   * Ses kaydını başlatır. Kullanıcıdan mikrofon izni ister ve MediaRecorder'ı hazırlar.
   * @param onVoiceRecording Kayıt başladığında/durduğunda UI'a durum bildiren fonksiyon
   * @param uploadCallback Kayıt bittiğinde oluşan Blob dosyasını ve süresini alan fonksiyon
   */
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
      // Mikrofon erişim izni al
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedAudioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      // Ses verisi geldikçe dizide biriktir
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedAudioChunksRef.current.push(event.data);
      };

      // Kayıt durduğunda çalışan olay işleyicisi
      recorder.onstop = () => {
        // Mikrofon akış kanallarını kapat (kırmızı kayıt ışığını söndürür)
        stream.getTracks().forEach((track) => track.stop());

        // Kullanıcı kaydı iptal ettiyse dosyayı oluşturma
        if (isRecordingCancelledRef.current) {
          recordedAudioChunksRef.current = [];
          isRecordingCancelledRef.current = false;
          return;
        }

        // Biriken parçalardan tek bir ses Blob dosyası üret
        const audioBlob = new Blob(recordedAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recordedAudioChunksRef.current = [];

        const finalDuration = recordingDurationRef.current;
        void uploadCallback(audioBlob, finalDuration);
      };

      setRecordingDuration(0);
      recordingDurationRef.current = 0;
      isRecordingCancelledRef.current = false;
      setIsRecordingPaused(false);

      // Kaydı başlat
      recorder.start();
      setIsRecordingAudio(true);
      onVoiceRecording(true);
    } catch {
      alert('Mikrofon izni alınamadı.');
    }
  };

  /**
   * Ses kaydını duraklatır (pause) veya duraklatılmışsa devam ettirir (resume).
   */
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

  /**
   * Ses kaydını iptal eder ve birikmiş ses parçalarını çöpe atar.
   */
  const cancelRecording = (onVoiceRecording: (isRecording: boolean) => void) => {
    isRecordingCancelledRef.current = true;
    if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingAudio(false);
    setIsRecordingPaused(false);
    onVoiceRecording(false);
  };

  /**
   * Ses kaydını tamamlar, durdurur ve ses dosyasının gönderilmesini tetikler.
   */
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

