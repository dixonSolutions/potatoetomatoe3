#!/bin/bash
# push_games.sh

echo "🚀 Syncing 5.3GB of games to Hugging Face..."

# This command is smart: it only uploads new or changed files.
huggingface-cli upload-folder BorysTheBear/Potato-Tomato-Games ./static/games . --repo-type=dataset

echo "✅ Upload complete!"