import { useState, useEffect, useRef, useCallback } from 'react';
import { assets } from '../../assets/assets';
import './VoiceRecorder.css';

/**
 * 语音识别组件
 * @param {Function} onTranscript - 识别到文本后的回调函数
 * @param {string} className - 自定义样式类名
 */
const VoiceRecorder = ({ onTranscript, className = '' }) => {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    // 检查浏览器是否支持语音识别
    if (!window.webkitSpeechRecognition && !window.SpeechRecognition) {
      console.warn('当前浏览器不支持语音识别功能');
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    const recognition = new SpeechRecognition();
    
    // 配置识别参数
    recognition.lang = 'zh-CN';              // 设置为中文
    recognition.continuous = false;          // 单次识别
    recognition.interimResults = false;      // 不返回临时结果
    recognition.maxAlternatives = 1;         // 只返回一个识别结果

    // 识别结果处理
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (onTranscript) {
        onTranscript(transcript);
      }
    };

    // 识别结束
    recognition.onend = () => {
      setIsRecording(false);
    };

    // 识别错误处理
    recognition.onerror = (event) => {
      console.error('语音识别错误:', event.error);
      setIsRecording(false);
      
      // 友好的错误提示
      if (event.error === 'no-speech') {
        console.warn('未检测到语音，请重试');
      } else if (event.error === 'audio-capture') {
        console.warn('无法访问麦克风，请检查权限');
      } else if (event.error === 'not-allowed') {
        console.warn('麦克风权限被拒绝');
      }
    };

    recognitionRef.current = recognition;

    // 清理函数
    return () => {
      if (recognitionRef.current) {
        recognition.stop();
      }
    };
  }, [onTranscript]);

  // 开始录音
  const startRecording = useCallback(() => {
    if (!recognitionRef.current) {
      console.warn('语音识别未初始化或浏览器不支持');
      return;
    }

    if (isRecording) {
      // 如果正在录音，则停止
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('启动语音识别失败:', error);
      setIsRecording(false);
    }
  }, [isRecording]);

  return (
    <img
      src={assets.mic_icon}
      alt="语音输入"
      onClick={startRecording}
      className={`mic-icon ${isRecording ? 'active recording' : ''} ${className}`}
      title={isRecording ? '点击停止录音' : '点击开始语音输入'}
    />
  );
};

export default VoiceRecorder;
