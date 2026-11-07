# Make spoken test answers (16 kHz mono WAV) with Windows' built-in text-to-speech, for
# verify-e2e.py's fake microphone: a real voice the app's live voice model can hear.
#
# usage: powershell -File make-voice.ps1 -Lines answers.txt -OutDir <scratch>\voice
#   answers.txt holds one answer per line as  name|sentence  e.g.
#   techno|I love dark, hypnotic techno. I want to find DJs who play Club Space.
# Writes <OutDir>\<name>.wav for each line and prints what it wrote. Exits 1 on failure.
param(
  [Parameter(Mandatory = $true)][string]$Lines,
  [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Speech
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $n = 0
  foreach ($line in Get-Content $Lines -Encoding UTF8) {
    if ($line -notmatch '^\s*([\w-]+)\s*\|\s*(.+)$') { continue }
    $name = $Matches[1]; $text = $Matches[2]
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SetOutputToWaveFile((Join-Path $OutDir "$name.wav"), $fmt)
    $s.Speak($text)
    $s.Dispose()
    Write-Output "wrote $name.wav  ($text)"
    $n++
  }
  if ($n -eq 0) { throw "no 'name|sentence' lines found in $Lines" }
  Write-Output "$n voice file(s) in $OutDir"
} catch {
  Write-Error $_
  exit 1
}
