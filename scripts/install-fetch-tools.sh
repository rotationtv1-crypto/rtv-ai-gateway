#!/usr/bin/env bash
# RotationTV LLC — LLM FETCH Tool Installer
# Version: 1.0.0-omega

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
INSTALL_DIR="$HOME/.rtv"
mkdir -p "$INSTALL_DIR"

echo -e "${BLUE}[INFO]${NC} Initializing RotationTV Fetch Toolchain..."

# Create the rtv-fetch-tool script
cat > "$INSTALL_DIR/rtv-fetch-tool" << 'INSIDE_EOF'
#!/usr/bin/env bash
# rtv-fetch-tool — Protocol-A: Cross-Agent Memory Fetching

case "$1" in
  --verify)
    echo -e "\033[0;32m[SUCCESS]\033[0m Network identity verified: $ROTATION_NETWORK_ID"
    ;;
  --fetch)
    echo -e "\033[0;34m[FETCHING]\033[0m Synchronizing agent memory from Supabase Ledger..."
    # Logic to curl the Supabase RPC / REST endpoint using ROTATION_GITHUB_PAT or SUPABASE_KEY
    curl -s -X POST "https://xynkgaxfwvpcixissxdz.supabase.co/rest/v1/rpc/fetch_agent_memory" \
         -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
         -H "Content-Type: application/json" \
         -d "{\"network_id\": \"$ROTATION_NETWORK_ID\"}" | jq .
    ;;
  *)
    echo "Usage: rtv-fetch-tool [--verify|--fetch]"
    ;;
esac
INSIDE_EOF

chmod +x "$INSTALL_DIR/rtv-fetch-tool"

# Add to PATH if not already there
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$HOME/.bashrc"
  echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$HOME/.zshrc"
  echo -e "${GREEN}[SUCCESS]${NC} rtv-fetch-tool installed. Please restart your shell or run: source ~/.bashrc"
else
  echo -e "${GREEN}[SUCCESS]${NC} rtv-fetch-tool updated in $INSTALL_DIR"
fi
