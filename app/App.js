import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StatusBar as RNStatusBar,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// Settes i .env (se README): EXPO_PUBLIC_API_URL og EXPO_PUBLIC_APP_TOKEN
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN;

const BRANDS = ['Bambu Lab', 'Prusa', 'Creality', 'Elegoo', 'Anycubic', 'Qidi', 'Sovol', 'Voron / Klipper', 'Annen'];
const SLICERS = ['Bambu Studio', 'OrcaSlicer', 'PrusaSlicer', 'Cura', 'Creality Print', 'Annen'];
const FILAMENTS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Nylon / PA', 'PC', 'Karbonfiber-blanding', 'Annet'];
const NOZZLES = ['0.4 mm', '0.2 mm', '0.6 mm', '0.8 mm'];
const PLATES = ['Textured PEI', 'Smooth PEI', 'Glass', 'Cool Plate / Supertack', 'Annet'];
// Foreslått slicer når man velger merke (kan endres etterpå)
const DEFAULT_SLICER = {
  'Bambu Lab': 'Bambu Studio',
  Prusa: 'PrusaSlicer',
  Creality: 'Creality Print',
  Qidi: 'OrcaSlicer',
  'Voron / Klipper': 'OrcaSlicer',
};

const MAX_IMAGES = 3;
const MAX_IMAGE_WIDTH = 1024;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_HISTORY = 20;

export default function App() {
  const [images, setImages] = useState([]); // [{ uri, base64 }]
  const [brand, setBrand] = useState('Bambu Lab');
  const [model, setModel] = useState('');
  const [slicer, setSlicer] = useState('Bambu Studio');
  const [filament, setFilament] = useState('PLA');
  const [nozzle, setNozzle] = useState('0.4 mm');
  const [plate, setPlate] = useState('Textured PEI');
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role: 'model' | 'user', text }]
  const [followText, setFollowText] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const scrollRef = useRef(null);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);

  const pickImage = async (useCamera) => {
    setErrorMsg(null);
    if (images.length >= MAX_IMAGES) {
      setErrorMsg('Du kan ha maks ' + MAX_IMAGES + ' bilder.');
      return;
    }
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setErrorMsg('Appen trenger tilgang til kamera eller bilder.');
      return;
    }

    const options = { mediaTypes: ['images'], quality: 1 };
    const pickerResult = useCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const asset = pickerResult.assets[0];
    try {
      // Skaler ned og komprimer så opplastingen går fort også på dårlig nett
      const actions =
        asset.width && asset.width > MAX_IMAGE_WIDTH ? [{ resize: { width: MAX_IMAGE_WIDTH } }] : [];
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      setImages((prev) => [...prev, { uri: out.uri, base64: out.base64 }].slice(0, MAX_IMAGES));
    } catch (e) {
      setErrorMsg('Kunne ikke behandle bildet: ' + (e.message || 'ukjent feil'));
    }
  };

  const removeImage = (idx) => setImages((prev) => prev.filter((_, i) => i !== idx));

  // Sender til serveren. Prøver én gang til automatisk ved nettverksbrudd.
  const callServer = async (extra) => {
    const payload = JSON.stringify({
      brand,
      model: model.trim(),
      slicer,
      filament,
      nozzle,
      plate,
      problem: problem.trim(),
      images: images.map((img) => ({ mimeType: 'image/jpeg', data: img.base64 })),
      ...extra,
    });

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-app-token': APP_TOKEN },
          body: payload,
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const errText = data.error ? data.error : 'Serveren svarte med feil, kode ' + response.status;
          throw Object.assign(new Error(errText), { fromServer: true });
        }
        if (!data.text) throw Object.assign(new Error('Fikk ikke noe svar fra AI-en.'), { fromServer: true });
        return data.text;
      } catch (error) {
        const networkError = !error.fromServer && error.name !== 'AbortError';
        if (attempt < 2 && networkError) continue;
        if (error.name === 'AbortError') throw new Error('Tidsavbrudd – AI-en brukte for lang tid. Prøv igjen.');
        if (networkError) throw new Error('Mistet nettforbindelsen. Sjekk nettet og prøv igjen.');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  };

  const analyzePrint = async () => {
    setErrorMsg(null);
    if (!problem.trim() && images.length === 0) {
      setErrorMsg('Ta et bilde eller skriv hva som skjedde med utskriften først.');
      return;
    }
    if (!API_URL || !APP_TOKEN) {
      setErrorMsg('Appen mangler serveroppsett (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_APP_TOKEN).');
      return;
    }
    setLoading(true);
    setMessages([]);
    try {
      const text = await callServer({});
      setMessages([{ role: 'model', text }]);
      scrollToEnd();
    } catch (error) {
      setErrorMsg('Feil: ' + (error.message || 'Kunne ikke koble til AI.'));
    } finally {
      setLoading(false);
    }
  };

  const sendFollowup = async () => {
    const q = followText.trim();
    if (!q || loading) return;
    if (messages.length + 2 > MAX_HISTORY) {
      setErrorMsg('Samtalen er blitt lang. Trykk «Ny analyse» for å starte på nytt.');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    const history = messages;
    setMessages([...history, { role: 'user', text: q }]);
    setFollowText('');
    scrollToEnd();
    try {
      const text = await callServer({ history, followup: q });
      setMessages([...history, { role: 'user', text: q }, { role: 'model', text }]);
      scrollToEnd();
    } catch (error) {
      setMessages(history);
      setFollowText(q);
      setErrorMsg('Feil: ' + (error.message || 'Kunne ikke koble til AI.'));
    } finally {
      setLoading(false);
    }
  };

  const newAnalysis = () => {
    setMessages([]);
    setFollowText('');
    setProblem('');
    setImages([]);
    setErrorMsg(null);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 100);
  };

  const renderSelector = (title, options, selected, onSelect) => (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.chipRow}>
        {options.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.chip, selected === item && styles.chipActive]}
            onPress={() => onSelect(item)}
          >
            <Text style={[styles.chipText, selected === item && styles.chipTextActive]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>PrintDoctor</Text>
        <Text style={styles.subHeader}>AI-hjelp for 3D-utskrifter – alle printere og slicere</Text>

        <View style={styles.imageBox}>
          {images.length > 0 ? (
            <View style={styles.thumbRow}>
              {images.map((img, i) => (
                <View key={img.uri} style={styles.thumbWrap}>
                  <Image source={{ uri: img.uri }} style={styles.thumb} />
                  <TouchableOpacity style={styles.thumbRemove} onPress={() => removeImage(i)}>
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.placeholderText}>
              Ta 1–3 bilder: helheten, nærbilde av feilen og gjerne fra siden
            </Text>
          )}
          {images.length < MAX_IMAGES && (
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secButton} onPress={() => pickImage(true)}>
                <Text style={styles.secButtonText}>Ta bilde</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secButton} onPress={() => pickImage(false)}>
                <Text style={styles.secButtonText}>Velg bilde</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {renderSelector('Printer', BRANDS, brand, (b) => {
          setBrand(b);
          if (DEFAULT_SLICER[b]) setSlicer(DEFAULT_SLICER[b]);
        })}
        <View style={styles.section}>
          <TextInput
            style={[styles.input, styles.inputSmall]}
            placeholder="Modell (valgfritt), f.eks. P1S, Ender-3 Pro, MK4"
            placeholderTextColor="#777"
            maxLength={60}
            value={model}
            onChangeText={setModel}
          />
        </View>
        {renderSelector('Slicer', SLICERS, slicer, setSlicer)}
        {renderSelector('Filament', FILAMENTS, filament, setFilament)}
        {renderSelector('Dysestørrelse', NOZZLES, nozzle, setNozzle)}
        {renderSelector('Byggeplate', PLATES, plate, setPlate)}

        <View style={styles.section}>
          <Text style={styles.label}>Hva skjedde, eller hva skal du printe?</Text>
          <TextInput
            style={styles.input}
            placeholder="F.eks. Hjørnene løfter seg, stringing..."
            placeholderTextColor="#777"
            multiline
            maxLength={1000}
            value={problem}
            onChangeText={setProblem}
          />
        </View>

        <TouchableOpacity
          style={[styles.mainButton, loading && styles.disabledButton]}
          onPress={analyzePrint}
          disabled={loading}
        >
          {loading && messages.length === 0 ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.mainButtonText}>{messages.length ? 'Analyser på nytt' : 'Analyser med AI'}</Text>
          )}
        </TouchableOpacity>

        {messages.length > 0 && (
          <View style={styles.chat}>
            {messages.map((m, i) =>
              m.role === 'model' ? (
                <View key={i} style={styles.resultBox}>
                  {i === 0 && <Text style={styles.resultTitle}>Diagnose og tiltak</Text>}
                  <Text style={styles.resultText} selectable>
                    {m.text}
                  </Text>
                </View>
              ) : (
                <View key={i} style={styles.userBubble}>
                  <Text style={styles.userText}>{m.text}</Text>
                </View>
              ),
            )}

            {loading && (
              <View style={styles.thinking}>
                <ActivityIndicator color="#00AE42" />
                <Text style={styles.thinkingText}>AI-en tenker …</Text>
              </View>
            )}

            <Text style={styles.label}>Spør videre</Text>
            <TextInput
              style={[styles.input, styles.inputFollow]}
              placeholder="F.eks. Hva om det ikke hjelper? Hvor finner jeg det i Cura?"
              placeholderTextColor="#777"
              multiline
              maxLength={1000}
              value={followText}
              onChangeText={setFollowText}
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.mainButton, styles.flex1, (loading || !followText.trim()) && styles.disabledButton]}
                onPress={sendFollowup}
                disabled={loading || !followText.trim()}
              >
                <Text style={styles.mainButtonText}>Send</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secButton, styles.newButton]} onPress={newAnalysis}>
                <Text style={styles.secButtonText}>Ny analyse</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  thumbRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 90, height: 90, borderRadius: 8 },
  thumbRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF5555',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },
  chat: { marginTop: 8 },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2C2C2C',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    maxWidth: '85%',
  },
  userText: { color: '#FFF', fontSize: 14 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  thinkingText: { color: '#AAA' },
  inputFollow: { minHeight: 60, marginBottom: 10 },
  flex1: { flex: 1, marginTop: 0 },
  newButton: { justifyContent: 'center' },
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight || 24 : 44,
  },
  scroll: { padding: 20, paddingBottom: 50 },
  header: { fontSize: 28, fontWeight: 'bold', color: '#00AE42', marginTop: 15 },
  subHeader: { fontSize: 14, color: '#AAA', marginBottom: 20 },
  imageBox: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  previewImage: { width: '100%', height: 220, borderRadius: 8, marginBottom: 8 },
  removeText: { color: '#FF7777', marginBottom: 12, fontSize: 13 },
  placeholderText: { color: '#777', marginVertical: 30, textAlign: 'center' },
  buttonRow: { flexDirection: 'row', gap: 10 },
  secButton: {
    backgroundColor: '#2C2C2C',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  secButtonText: { color: '#FFF', fontWeight: '600' },
  section: { marginBottom: 18 },
  label: { color: '#EEE', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#1E1E1E',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  chipActive: { backgroundColor: '#00AE42', borderColor: '#00AE42' },
  chipText: { color: '#CCC', fontSize: 13 },
  chipTextActive: { color: '#000', fontWeight: 'bold' },
  input: {
    backgroundColor: '#1E1E1E',
    color: '#FFF',
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#333',
  },
  mainButton: {
    backgroundColor: '#00AE42',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  inputSmall: { minHeight: 0, paddingVertical: 10 },
  disabledButton: { opacity: 0.6 },
  mainButtonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  errorBox: {
    backgroundColor: '#3A1818',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FF5555',
  },
  errorText: { color: '#FF9999', fontSize: 13 },
  resultBox: {
    backgroundColor: '#1A241E',
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#00AE42',
  },
  resultTitle: { color: '#00AE42', fontWeight: 'bold', fontSize: 16, marginBottom: 10 },
  resultText: { color: '#EFEFEF', fontSize: 14, lineHeight: 22 },
});
