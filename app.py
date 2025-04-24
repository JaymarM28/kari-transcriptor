# Modificaciones necesarias en app.py para enviar actualizaciones de progreso

from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import os
import speech_recognition as sr
from werkzeug.utils import secure_filename
from pydub import AudioSegment
from pydub.silence import split_on_silence
import tempfile
import time
import json

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max-limit
app.config['ALLOWED_EXTENSIONS'] = {'wav', 'mp3', 'ogg', 'flac', 'm4a'}

# Asegúrate de que el directorio de uploads exista
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

# Nueva ruta para streaming de progreso
@app.route('/transcribe/<filename>', methods=['GET'])
def transcribe_stream(filename):
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    # Verificar que el archivo existe
    if not os.path.exists(file_path):
        return jsonify({"success": False, "error": "Archivo no encontrado"})
    
    # Función generadora para streaming
    def generate():
        whole_text = ""
        total_chunks = 0
        current_chunk = 0
        
        try:
            # Determinar formato de audio
            file_ext = file_path.split('.')[-1].lower()
            
            # Convertir a WAV si es necesario
            if file_ext != 'wav':
                temp_wav = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
                temp_wav_path = temp_wav.name
                temp_wav.close()
                
                # Enviar actualización
                yield f"data: {json.dumps({'status': 'converting', 'message': 'Convirtiendo archivo de audio...', 'progress': 5})}\n\n"
                
                audio = AudioSegment.from_file(file_path)
                audio.export(temp_wav_path, format="wav")
                file_path_to_process = temp_wav_path
                
                # Enviar actualización
                yield f"data: {json.dumps({'status': 'converted', 'message': 'Conversión completada', 'progress': 10})}\n\n"
            else:
                file_path_to_process = file_path
            
            # Cargar archivo de audio
            yield f"data: {json.dumps({'status': 'loading', 'message': 'Cargando archivo de audio...', 'progress': 15})}\n\n"
            
            sound = AudioSegment.from_wav(file_path_to_process)
            
            # Dividir en fragmentos
            yield f"data: {json.dumps({'status': 'splitting', 'message': 'Dividiendo audio en fragmentos...', 'progress': 20})}\n\n"
            
            chunks = split_on_silence(
                sound,
                min_silence_len=500,
                silence_thresh=sound.dBFS - 14,
                keep_silence=500
            )
            
            # Si no hay suficientes silencios, dividir por tiempo
            if len(chunks) < 5:
                yield f"data: {json.dumps({'status': 'splitting_time', 'message': 'No se detectaron suficientes silencios, dividiendo por tiempo...', 'progress': 25})}\n\n"
                
                chunk_length_ms = 30000  # 30 segundos
                chunks = [sound[i:i + chunk_length_ms] for i in range(0, len(sound), chunk_length_ms)]
            
            total_chunks = len(chunks)
            yield f"data: {json.dumps({'status': 'processing', 'message': f'Audio dividido en {total_chunks} fragmentos', 'totalChunks': total_chunks, 'progress': 30})}\n\n"
            
            # Inicializar reconocedor
            recognizer = sr.Recognizer()
            
            # Procesar cada fragmento
            for i, audio_chunk in enumerate(chunks):
                current_chunk = i + 1
                progress = 30 + int(60 * (i / total_chunks))  # Progreso de 30% a 90%
                
                # Actualizar progreso
                yield f"data: {json.dumps({'status': 'transcribing', 'message': f'Transcribiendo fragmento {current_chunk}/{total_chunks}', 'currentChunk': current_chunk, 'totalChunks': total_chunks, 'progress': progress})}\n\n"
                
                # Exportar fragmento a archivo temporal
                chunk_filename = tempfile.NamedTemporaryFile(delete=False, suffix='.wav').name
                audio_chunk.export(chunk_filename, format="wav")
                
                # Transcribir
                with sr.AudioFile(chunk_filename) as source:
                    audio_data = recognizer.record(source)
                    try:
                        text = recognizer.recognize_google(audio_data, language="es-ES")
                        whole_text += text + " "
                        
                        # Enviar texto parcial
                        yield f"data: {json.dumps({'status': 'partial_text', 'partialText': text, 'chunkNumber': current_chunk, 'progress': progress})}\n\n"
                        
                    except sr.UnknownValueError:
                        yield f"data: {json.dumps({'status': 'chunk_error', 'message': f'No se pudo entender el fragmento {current_chunk}', 'progress': progress})}\n\n"
                    except sr.RequestError as e:
                        yield f"data: {json.dumps({'status': 'error', 'message': f'Error de API en fragmento {current_chunk}: {str(e)}', 'progress': progress})}\n\n"
                        # Reintento
                        time.sleep(2)
                        try:
                            text = recognizer.recognize_google(audio_data, language="es-ES")
                            whole_text += text + " "
                            yield f"data: {json.dumps({'status': 'retry_success', 'partialText': text, 'chunkNumber': current_chunk, 'progress': progress})}\n\n"
                        except:
                            yield f"data: {json.dumps({'status': 'retry_failed', 'message': f'Reintento fallido para fragmento {current_chunk}', 'progress': progress})}\n\n"
                
                # Limpiar archivo temporal
                os.unlink(chunk_filename)
                
                # Pausa para no saturar la API
                time.sleep(0.5)
            
            # Limpiar archivo WAV temporal si se creó
            if file_ext != 'wav' and 'temp_wav_path' in locals():
                try:
                    os.unlink(temp_wav_path)
                except:
                    pass
            
            # Finalizar con el texto completo
            if whole_text.strip():
                yield f"data: {json.dumps({'status': 'completed', 'fullText': whole_text.strip(), 'progress': 100})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'message': 'No se pudo transcribir ninguna parte del audio', 'progress': 100})}\n\n"
        
        except Exception as e:
            import traceback
            error_message = str(e)
            trace = traceback.format_exc()
            yield f"data: {json.dumps({'status': 'error', 'message': f'Error: {error_message}', 'trace': trace, 'progress': 100})}\n\n"
        
        finally:
            # Limpiar el archivo original
            try:
                os.unlink(file_path)
            except:
                pass
    
    # Devolver respuesta SSE (Server-Sent Events)
    return Response(stream_with_context(generate()), mimetype="text/event-stream")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No se ha enviado ningún archivo"})
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({"success": False, "error": "No se ha seleccionado ningún archivo"})
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # En lugar de procesar aquí, devolver el nombre del archivo para iniciar el streaming
        return jsonify({"success": True, "filename": filename})
    
    return jsonify({"success": False, "error": "Tipo de archivo no permitido"})

if __name__ == '__main__':
    app.run(debug=True, threaded=True)